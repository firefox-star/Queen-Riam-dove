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

// ===================== SUPABASE BACKEND =====================

async function getDb() {
    if (db) return db;
    db = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    console.log('[SupabaseAuth] Connected to database');
    await db.query(`CREATE TABLE IF NOT EXISTS "${TABLE}" (key TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    console.log('[SupabaseAuth] Table ready:', TABLE);
    return db;
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

async function useSupabaseAuthState(folder) {
    const { BufferJSON, initAuthCreds, proto } = getBaileys();

    const creds = (await sbReadData('creds.json')) || initAuthCreds();

    if (creds.registration) {
        console.log('========================================');
        console.log('[SupabaseAuth] SESSION RESTORED FROM DATABASE');
        console.log('[SupabaseAuth] No re-pairing needed!');
        console.log('========================================');
    } else {
        console.log('[SupabaseAuth] Fresh credentials — pairing code will be requested.');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await sbReadData(`${type}-${id}.json`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
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
            return sbWriteData(creds, 'creds.json');
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

module.exports = { patchAuth, useSupabaseAuthState };
