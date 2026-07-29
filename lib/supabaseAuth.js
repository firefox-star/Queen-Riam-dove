/**
 * Supabase-backed Baileys Auth State Store
 * 
 * Identical API to useMultiFileAuthState.
 * Stores session in Supabase PostgreSQL instead of filesystem.
 * Falls back to file-based if DATABASE_URL is not set.
 */

const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

let _baileys = null;
let _originalUseMultiFileAuthState = null;

function getBaileys() {
    if (!_baileys) _baileys = require('@whiskeysockets/baileys');
    return _baileys;
}

const DATABASE_URL = process.env.DATABASE_URL;
const TABLE = process.env.SUPABASE_SESSION_TABLE || 'wa_session_store';
let db = null;
let dbReady = false;
let dbConnecting = false;

// ===================== SUPABASE BACKEND =====================

async function getDb() {
    if (db && dbReady) return db;
    if (dbConnecting) {
        // Wait for existing connection attempt
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (db && dbReady) return db;
        }
        throw new Error('[SupabaseAuth] Timeout waiting for DB connection');
    }
    
    dbConnecting = true;
    try {
        db = new Client({ 
            connectionString: DATABASE_URL, 
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 15000,
            statement_timeout: 10000,
        });
        await db.connect();
        
        // Create table if not exists
        await db.query(`CREATE TABLE IF NOT EXISTS "${TABLE}" (
            key TEXT PRIMARY KEY, 
            data JSONB NOT NULL, 
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        
        dbReady = true;
        console.log('[SupabaseAuth] ✅ Connected to database, table ready:', TABLE);
        return db;
    } catch (err) {
        console.error('[SupabaseAuth] ❌ Database connection FAILED:', err.message);
        db = null;
        dbReady = false;
        throw err;
    } finally {
        dbConnecting = false;
    }
}

/** Pre-warm the DB connection on startup so we fail fast if DB is unreachable */
async function ensureDb() {
    try {
        await getDb();
        return true;
    } catch (e) {
        return false;
    }
}

function fixFileName(file) {
    return file.replace(/\//g, '__').replace(/:/g, '-');
}

const bufferReviver = (_key, value) => {
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return value;
};

async function sbReadData(file) {
    const client = await getDb();
    const key = fixFileName(file);
    const { rows } = await client.query(`SELECT data FROM "${TABLE}" WHERE key = $1`, [key]);
    if (!rows.length) return null;
    return JSON.parse(JSON.stringify(rows[0].data), bufferReviver);
}

async function sbWriteData(data, file) {
    const client = await getDb();
    const key = fixFileName(file);
    await client.query(
        `INSERT INTO "${TABLE}" (key, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        [key, JSON.stringify(data, getBaileys().BufferJSON.replacer)]
    );
}

async function sbRemoveData(file) {
    const client = await getDb();
    const key = fixFileName(file);
    await client.query(`DELETE FROM "${TABLE}" WHERE key = $1`, [key]);
}

/** Check if the Supabase table has any valid session data */
async function hasValidSession() {
    try {
        const client = await getDb();
        const { rows } = await client.query(`SELECT data FROM "${TABLE}" WHERE key = 'creds.json'`);
        if (!rows.length) return false;
        const creds = rows[0].data;
        // Valid session must have registration data (means pairing was completed)
        return creds && creds.registration && creds.me;
    } catch (e) {
        console.error('[SupabaseAuth] Error checking session validity:', e.message);
        return false;
    }
}

async function useSupabaseAuthState(folder) {
    const { BufferJSON, initAuthCreds, proto } = getBaileys();

    // Check if we have a valid saved session
    let creds;
    try {
        creds = (await sbReadData('creds.json')) || initAuthCreds();
    } catch (err) {
        console.error('[SupabaseAuth] ⚠️ Could not read creds from DB, starting fresh:', err.message);
        creds = initAuthCreds();
    }

    // Check if loaded creds are actually valid (have registration)
    if (creds.registration && creds.me) {
        console.log('========================================');
        console.log('[SupabaseAuth] ✅ SESSION RESTORED FROM DATABASE');
        console.log('[SupabaseAuth] No re-pairing needed!');
        console.log('[SupabaseAuth] Device:', creds.me.id || creds.me.name || 'unknown');
        console.log('========================================');
    } else {
        console.log('[SupabaseAuth] 🔑 Fresh credentials — pairing code will be requested.');
        console.log('[SupabaseAuth] ⏳ Please enter the pairing code on your WhatsApp when shown.');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        try {
                            let value = await sbReadData(`${type}-${id}.json`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        } catch (err) {
                            // Silently skip failed key reads
                            data[id] = undefined;
                        }
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            tasks.push(value ? sbWriteData(value, file) : sbRemoveData(file));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async () => {
            // CRITICAL: Only save creds to DB if they have valid registration
            // Unpaired/fresh creds should NOT be saved - they cause 401 on reload
            if (!creds.registration || !creds.me) {
                console.log('[SupabaseAuth] ⏭️  Skipping creds save — not yet paired/registered.');
                return;
            }
            try {
                await sbWriteData(creds, 'creds.json');
                console.log('[SupabaseAuth] 💾 Session saved to database successfully.');
            } catch (err) {
                console.error('[SupabaseAuth] ❌ Failed to save creds to DB:', err.message);
            }
        },
    };
}

// ===================== PATCHER =====================

/**
 * Call this BEFORE requiring index.js.
 * It replaces baileys.useMultiFileAuthState with our Supabase version.
 * Falls back to original if DATABASE_URL is not set.
 */
function patchAuth() {
    const baileys = getBaileys();
    _originalUseMultiFileAuthState = baileys.useMultiFileAuthState;

    if (!DATABASE_URL) {
        console.log('[SupabaseAuth] DATABASE_URL not set — keeping file-based session.');
        return; // Don't patch, keep original
    }

    baileys.useMultiFileAuthState = useSupabaseAuthState;
    console.log('[SupabaseAuth] Patched useMultiFileAuthState -> Supabase backend');
}

module.exports = { patchAuth, useSupabaseAuthState, ensureDb, hasValidSession };
