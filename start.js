/**
 * Entry point wrapper.
 * 1. Patches Baileys session storage to use Supabase
 * 2. Starts a health-check HTTP server on Railway's PORT
 * 3. Loads the real bot (index.js)
 */

const http = require('http');
const { patchAuth, ensureDb } = require('./lib/supabaseAuth');

// ── Step 1: Patch Baileys BEFORE anything else loads it ──
patchAuth();

// ── Step 2: Health check server on Railway's PORT ──
// Railway sends SIGTERM if nothing listens on $PORT.
// The bot's own Express runs on 8080, so we add a lightweight health server here.
const HEALTH_PORT = parseInt(process.env.PORT, 10) || 1000;

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'queen-riam-dove' }));
    } else {
        res.writeHead(404);
        res.end('not found');
    }
});

healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[HealthCheck] Listening on port ${HEALTH_PORT} for Railway health probes`);
});

// ── Step 3: Pre-warm DB connection ──
if (process.env.DATABASE_URL) {
    ensureDb().then(ok => {
        if (!ok) console.error('[SupabaseAuth] ⚠️  Could not reach database on startup. Session will not persist.');
    });
}

// ── Step 4: Load the real bot ──
require('./index.js');
