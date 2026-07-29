/**
 * Example Plugin: World Clock
 * Shows current time in multiple timezones
 */
const { plugin } = require('../lib/pluginLoader');

plugin({
    command: 'worldtime',
    description: 'Show current time in major cities',
    category: 'general'
}, async (sock, chatId, message, args, query) => {
    const zones = [
        ['Lagos', 'Africa/Lagos'],
        ['London', 'Europe/London'],
        ['New York', 'America/New_York'],
        ['Dubai', 'Asia/Dubai'],
        ['Tokyo', 'Asia/Tokyo'],
        ['Sydney', 'Australia/Sydney'],
    ];

    let text = '*🌍 World Clock*\n\n';
    for (const [city, tz] of zones) {
        const time = new Date().toLocaleTimeString('en-US', {
            timeZone: tz,
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: true
        });
        text += `📍 *${city}*: ${time}\n`;
    }

    await sock.sendMessage(chatId, { text }, { quoted: message });
});
