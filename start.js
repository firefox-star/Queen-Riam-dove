/**
 * Entry point wrapper.
 * Patches Baileys session storage to use Supabase, then loads the real bot.
 * 
 * Change package.json "start" to: node start.js
 * Change Dockerfile CMD to: ["node", "start.js"]
 */

// Patch BEFORE anything else loads baileys
const { patchAuth } = require('./lib/supabaseAuth');
patchAuth();

// Now load the real bot
require('./index.js');
