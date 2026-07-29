module.exports = async function imdbCommand(sock, chatId) {
    await sock.sendMessage(chatId, {
        text: "🎉 SUCCESS!\n\nCustom JavaScript is running inside Queen Riam."
    });
};
