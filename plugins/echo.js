/**
 * Example Plugin: Echo
 * Repeats back whatever you type after .echo
 * 
 * Install command (already installed by default):
 *   .script install <url>   — install from GitHub Gist/raw URL
 *   .script remove echo     — remove this plugin
 *   .script plugins         — list all plugins
 */
const { plugin } = require('../lib/pluginLoader');

plugin({
    command: 'echo',
    description: 'Repeats your message back',
    category: 'general',
    aliases: ['repeat', 'say']
}, async (sock, chatId, message, args, query) => {
    if (!query) {
        await sock.sendMessage(chatId, { 
            text: '*Echo Plugin*\nUsage: .echo <your text>\nAliases: .repeat, .say'
        }, { quoted: message });
        return;
    }
    await sock.sendMessage(chatId, { 
        text: `💬 ${query}`
    }, { quoted: message });
});
