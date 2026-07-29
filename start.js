/**
 * Entry point wrapper.
 * 1. Patches Baileys session storage to use Supabase
 * 2. BLOCKS until DB connection is verified (or fails clearly)
 * 3. Starts a health-check HTTP server on Railway's PORT
 * 4. Loads the real bot (index.js)
 */

const http = require('http');

// ── DIAGNOSTIC: Show immediately what env vars we have ──
const DB_URL = process.env.DATABASE_URL;
if (DB_URL) {
    // Mask password for safety
    const masked = DB_URL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
    console.log('[SupabaseAuth] DATABASE_URL found:', masked);
} else {
    console.log('[SupabaseAuth] ❌ DATABASE_URL is NOT set in environment variables!');
    console.log('[SupabaseAuth] Session will use filesystem (ephemeral) — will need re-pairing on every restart.');
    console.log('[SupabaseAuth] ⚠️  FIX: Go to Railway → your service → Variables → add DATABASE_URL');
}

const { patchAuth, ensureDb } = require('./lib/supabaseAuth');

// ── Step 1: Patch Baileys BEFORE anything else loads it ──
patchAuth();

// ── Step 2: Health check server on Railway's PORT ──
// Railway sends SIGTERM if nothing listens on $PORT.
// The bot's own Express runs on 8080, so we add a lightweight health server here.
const HEALTH_PORT = parseInt(process.env.PORT, 10) || 1000;
let dbStatus = DB_URL ? 'checking...' : 'not configured';

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            service: 'queen-riam-dove',
            database: dbStatus
        }));
    } else {
        res.writeHead(404);
        res.end('not found');
    }
});

healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[HealthCheck] ✅ Listening on port ${HEALTH_PORT} for Railway health probes`);
});

// ── Step 3: Verify DB connection BEFORE loading bot ──
async function start() {
    if (DB_URL) {
        console.log('[SupabaseAuth] 🔄 Testing database connection...');
        const ok = await ensureDb();
        if (ok) {
            dbStatus = 'connected';
            console.log('[SupabaseAuth] ✅ Database is ready — session WILL persist across restarts!');
        } else {
            dbStatus = 'failed';
            console.error('[SupabaseAuth] ❌ DATABASE CONNECTION FAILED!');
            console.error('[SupabaseAuth] ❌ Session will NOT persist. Check your DATABASE_URL.');
        }
    }

    // ── Step 4: Load the real bot (only after DB check) ──
    require('./index.js');
}

start();
