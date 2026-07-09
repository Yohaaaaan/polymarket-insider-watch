import { sendTelegramAlert } from './src/telegramBot';

async function test() {
    console.log("Testing Telegram alert...");
    await sendTelegramAlert("Test message from Antigravity Debugger 🤖");
    console.log("Test finished. Check your Telegram.");
}

test().catch(console.error);
