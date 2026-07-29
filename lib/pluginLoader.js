/**
 * Queen Riam Dove — Plugin System
 * 
 * Real plugin loader that the README promised but never delivered.
 * Installs plugins from GitHub Gist/raw URLs, loads them at startup,
 * and routes matching commands to plugin handlers.
 * 
 * Plugin creators use: const { plugin } = require('../lib/pluginLoader')
 * 
 * ZERO modifications to obfuscated index.js / main.js.
 * Hooks into lib/myfunc.js smsg() for message routing.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const settings = require('../settings');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const PLUGIN_META_FILE = path.join(PLUGINS_DIR, '_registry.json');

// ── In-memory command registry ──
// Map: commandName (lowercase, no prefix) → { handler, description, category, fileName }
const registry = new Map();

// ── Public API for plugin creators ──
function plugin(meta, handler) {
    if (!meta || !meta.command || typeof handler !== 'function') {
        console.error('[PluginSystem] Invalid plugin() call — needs { command, ... } and async handler');
        return;
    }
    const name = meta.command.toLowerCase().replace(/^\./, '');
    registry.set(name, {
        handler,
        description: meta.description || 'No description',
        category: meta.category || 'plugin',
        fileName: meta._fileName || 'unknown',
        aliases: (meta.aliases || []).map(a => a.toLowerCase().replace(/^\./, '')),
    });
    // Also register aliases
    for (const alias of (meta.aliases || [])) {
        const a = alias.toLowerCase().replace(/^\./, '');
        registry.set(a, {
            handler,
            description: meta.description || 'No description',
            category: meta.category || 'plugin',
            fileName: meta._fileName || 'unknown',
            isAlias: true,
            mainCommand: name,
        });
    }
}

// ── Load all plugins from plugins/ directory ──
function loadAllPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
        console.log('[PluginSystem] Created plugins/ directory');
        return;
    }

    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    if (!files.length) {
        console.log('[PluginSystem] No plugins found in plugins/');
        return;
    }

    let loaded = 0;
    let failed = 0;

    for (const file of files) {
        try {
            const filePath = path.join(PLUGINS_DIR, file);
            // Inject _fileName so plugin() knows which file registered it
            const mod = require(filePath);
            // If the plugin uses module.exports = function(...) pattern
            // instead of plugin() API, handle it here
            if (typeof mod === 'function' && !mod._isPluginRegistered) {
                const cmdName = path.basename(file, '.js').toLowerCase();
                registry.set(cmdName, {
                    handler: mod,
                    description: 'Plugin command',
                    category: 'plugin',
                    fileName: file,
                });
            }
            loaded++;
        } catch (err) {
            console.error(`[PluginSystem] Failed to load ${file}:`, err.message);
            failed++;
        }
    }

    console.log(`[PluginSystem] Loaded ${loaded} plugin(s), ${failed} failed, ${registry.size} command(s) registered`);
}

// ── Route incoming messages to plugin handlers ──
// Called from smsg() in lib/myfunc.js for EVERY message.
// Returns true if a plugin handled the message.
function checkPluginCommand(sock, m) {
    if (!m || !m.body || !m.chat) return false;

    const prefix = settings.prefix || '.';
    if (!m.body.startsWith(prefix)) return false;

    const text = m.body.slice(prefix.length).trim();
    const cmdMatch = text.match(/^(\S+)(?:\s+(.*))?$/);
    if (!cmdMatch) return false;

    const cmdName = cmdMatch[1].toLowerCase();
    const args = cmdMatch[2] ? cmdMatch[2].split(/\s+/) : [];
    const query = cmdMatch[2] || '';

    const entry = registry.get(cmdName);
    if (!entry) return false;

    // Execute plugin handler asynchronously — never block the main flow
    entry.handler(sock, m.chat, m, args, query).catch(err => {
        console.error(`[PluginSystem] Error in plugin "${cmdName}":`, err.message);
    });

    return true; // Signal that a plugin handled this
}

// ── Install a plugin from URL ──
async function installPlugin(url) {
    if (!url || !isUrl(url)) {
        return { success: false, message: 'Invalid URL. Use a raw GitHub/Gist URL ending in .js' };
    }

    // Ensure plugins dir exists
    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    try {
        const response = await axios.get(url, { timeout: 15000, responseType: 'text' });
        let code = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        // Basic safety check — must look like JS
        if (!code.includes('function') && !code.includes('module.exports') && !code.includes('=>')) {
            return { success: false, message: 'URL does not appear to contain valid JavaScript code.' };
        }

        // Extract filename from URL or generate one
        let fileName;
        if (url.includes('/')) {
            const urlPath = url.split('/').pop().split('?')[0];
            if (urlPath.endsWith('.js')) {
                fileName = urlPath;
            } else {
                fileName = urlPath + '.js';
            }
        } else {
            fileName = `plugin_${Date.now()}.js`;
        }

        // Prepend fileName metadata so plugin() can reference it
        const wrappedCode = `Object.defineProperty(module, '_fileName', { value: '${fileName}', writable: false });
${code}`;

        const filePath = path.join(PLUGINS_DIR, fileName);
        fs.writeFileSync(filePath, wrappedCode, 'utf-8');

        // Try to load it immediately
        try {
            delete require.cache[filePath];
            const mod = require(filePath);
            if (typeof mod === 'function' && !mod._isPluginRegistered) {
                const cmdName = path.basename(fileName, '.js').toLowerCase();
                registry.set(cmdName, {
                    handler: mod,
                    description: 'Plugin command',
                    category: 'plugin',
                    fileName,
                });
            }
        } catch (loadErr) {
            // Plugin saved but failed to load — report the error
            return { success: true, message: `Plugin saved as *${fileName}* but failed to load: ${loadErr.message}` };
        }

        return { success: true, message: `Plugin *${fileName}* installed successfully! Use .${path.basename(fileName, '.js')} to run it.` };

    } catch (err) {
        return { success: false, message: `Download failed: ${err.message}` };
    }
}

// ── Remove a plugin ──
function removePlugin(name) {
    if (!name) return { success: false, message: 'Provide a plugin name to remove.' };

    const cleanName = name.replace(/\.js$/, '').toLowerCase();

    // Find the file
    if (!fs.existsSync(PLUGINS_DIR)) {
        return { success: false, message: 'No plugins directory found.' };
    }

    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    const match = files.find(f => path.basename(f, '.js').toLowerCase() === cleanName);

    if (!match) {
        return { success: false, message: `Plugin "${name}" not found. Use .script plugins to see installed plugins.` };
    }

    const filePath = path.join(PLUGINS_DIR, match);
    fs.unlinkSync(filePath);

    // Remove from registry
    for (const [key, val] of registry) {
        if (val.fileName === match) registry.delete(key);
    }

    // Clear require cache
    delete require.cache[filePath];

    return { success: true, message: `Plugin *${match}* removed successfully.` };
}

// ── List all installed plugins ──
function listPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) {
        return { plugins: [], count: 0 };
    }

    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
    const plugins = [];
    const seen = new Set();

    for (const [cmdName, entry] of registry) {
        if (entry.isAlias || seen.has(entry.fileName)) continue;
        seen.add(entry.fileName);
        plugins.push({
            command: `.${cmdName}`,
            description: entry.description,
            category: entry.category,
            file: entry.fileName,
        });
    }

    return { plugins, count: plugins.length };
}

// ── Reload all plugins (clear cache + reload) ──
function reloadPlugins() {
    // Clear all plugin entries from registry
    for (const [key, val] of registry) {
        if (val.category === 'plugin' || val.fileName !== 'unknown') {
            registry.delete(key);
        }
    }

    // Clear require cache for plugin files
    if (fs.existsSync(PLUGINS_DIR)) {
        for (const file of fs.readdirSync(PLUGINS_DIR)) {
            if (file.endsWith('.js')) {
                delete require.cache[path.join(PLUGINS_DIR, file)];
            }
        }
    }

    // Reload
    loadAllPlugins();
    return registry.size;
}

// ── URL validator ──
function isUrl(url) {
    return /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/.test(url);
}

// ── Initialize on first require ──
console.log('[PluginSystem] Loading...');
loadAllPlugins();

module.exports = {
    plugin,
    checkPluginCommand,
    installPlugin,
    removePlugin,
    listPlugins,
    reloadPlugins,
    registry, // expose for inspection
};
