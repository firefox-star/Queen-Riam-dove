const axios = require("axios");
const getFakeVcard = require('../lib/fakeVcard');
const { getLang } = require('../lib/lang');
const { installPlugin, removePlugin, listPlugins, reloadPlugins } = require('../lib/pluginLoader');

async function scriptCommand(sock, chatId, message, args, query) {
    const sub = (args[0] || '').toLowerCase();

    // ── Plugin Management Subcommands ──
    if (sub === 'install') {
        const url = args.slice(1).join(' ');
        if (!url) {
            return sock.sendMessage(chatId, {
                text: '*🔌 Plugin Install*\n\nUsage: .script install <url>\n\nExample:\n.script install https://gist.githubusercontent.com/user/abc123/raw/myplugin.js\n\nPlugins can also use the API:\n```js\nconst { plugin } = require("../lib/pluginLoader");\nplugin({ command: "hello", description: "Says hi", category: "general" },\n  async (sock, chatId, message, args, query) => {\n    await sock.sendMessage(chatId, { text: "Hello!" }, { quoted: message });\n  }\n);\n```'
            }, { quoted: message });
        }
        await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });
        const result = await installPlugin(url);
        await sock.sendMessage(chatId, {
            text: result.success
                ? `✅ ${result.message}`
                : `❌ ${result.message}`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: result.success ? '✅' : '❌', key: message.key } });
        return;
    }

    if (sub === 'remove' || sub === 'uninstall' || sub === 'delete') {
        const name = args.slice(1).join(' ');
        const result = removePlugin(name);
        await sock.sendMessage(chatId, {
            text: result.success
                ? `✅ ${result.message}`
                : `❌ ${result.message}`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: result.success ? '✅' : '❌', key: message.key } });
        return;
    }

    if (sub === 'plugins' || sub === 'list') {
        const { plugins, count } = listPlugins();
        if (count === 0) {
            return sock.sendMessage(chatId, {
                text: '*📦 Plugins*\n\nNo plugins installed.\nUse .script install <url> to add one.'
            }, { quoted: message });
        }
        let text = `*📦 Installed Plugins (${count})*\n\n`;
        for (const p of plugins) {
            text += `🔧 *${p.command}* — ${p.description}\n   Category: ${p.category} | File: ${p.file}\n\n`;
        }
        text += `Use .script install <url> to add more.`;
        await sock.sendMessage(chatId, { text }, { quoted: message });
        return;
    }

    if (sub === 'reload') {
        const count = reloadPlugins();
        await sock.sendMessage(chatId, {
            text: `🔄 Reloaded plugins. ${count} command(s) now active.`,
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
        return;
    }

    // ── Original .script behavior: send repo ZIP ──
    try {
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        const repoUrl = "https://github.com/Dev-Kango/Queen-Riam";
        const zipUrl = `${repoUrl}/archive/refs/heads/main.zip`;
        const { data: repo } = await axios.get("https://api.github.com/repos/Dev-Kango/Queen-Riam");
        const { data: avatarBuffer } = await axios.get(repo.owner.avatar_url, {
            responseType: "arraybuffer"
        });

        const caption =
            `*👑 QUEEN RIAM Repository*\n\n` +
            `🔗 *Repository URL:* ${repoUrl}\n` +
            `📂 *Branch:* main\n` +
            `📦 *File:* Queen-Riam-main.zip\n\n` +
            `🌟 *Stars:* ${repo.stargazers_count}\n` +
            `🔀 *Forks:* ${repo.forks_count}\n` +
            `📅 *Updated:* ${new Date(repo.updated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}\n\n` +
            `✨ The ZIP file contains the full repository source code.\n\n` +
            `💡 Tip: Fork it, star it, and hack your own version!\n\n` +
            `──\n` +
            `🔌 *Plugin Commands:*\n` +
            `.script install <url> — Install a plugin\n` +
            `.script remove <name> — Remove a plugin\n` +
            `.script plugins — List installed plugins\n` +
            `.script reload — Reload all plugins`;

        await sock.sendMessage(chatId, {
            text: caption,
            contextInfo: {
                externalAdReply: {
                    title: "RIAM GitHub Repo + Plugins",
                    body: "Download source or manage plugins",
                    mediaType: 1,
                    thumbnail: Buffer.from(avatarBuffer),
                    sourceUrl: repoUrl
                }
            }
        }, { quoted: getFakeVcard() });

        const { data: zipBuffer } = await axios.get(zipUrl, { responseType: "arraybuffer" });
        await sock.sendMessage(chatId, {
            document: Buffer.from(zipBuffer),
            fileName: "Queen-Riam-main.zip",
            mimetype: "application/zip"
        }, { quoted: getFakeVcard() });

        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });

    } catch (err) {
        console.error("Script command error:", err);
        await sock.sendMessage(chatId, { text: getLang(sock).script_failed }, { quoted: getFakeVcard() });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
    }
}

module.exports = scriptCommand;