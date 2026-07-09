import axios from 'axios';
import dotenv from 'dotenv';
import { db } from './database';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegramAlert(message: string) {
    if (!BOT_TOKEN || !CHAT_ID) return;
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
    } catch (error: any) {
        console.error('Error sending Telegram alert:', error.response?.data || error.message);
    }
}

let lastDashboardMessageId: string | null = null;

export async function updateTelegramDashboard(message: string) {
    if (!BOT_TOKEN || !CHAT_ID) return;

    // Load from DB if not in memory
    if (!lastDashboardMessageId) {
        const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get('dashboard_msg_id') as any;
        if (row) lastDashboardMessageId = row.value;
    }

    if (lastDashboardMessageId) {
        // Try to edit the existing dashboard message
        const editUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
        try {
            await axios.post(editUrl, {
                chat_id: CHAT_ID,
                message_id: lastDashboardMessageId,
                text: message,
                parse_mode: 'Markdown'
            });
            return;
        } catch (error: any) {
            // If failed (e.g. message deleted or too old), send new one below
            console.warn('Dashboard edit failed, sending new message...');
        }
    }

    // Send new message
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        const response = await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        const newId = response.data.result.message_id.toString();
        lastDashboardMessageId = newId;
        db.prepare('INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)').run('dashboard_msg_id', newId);
    } catch (error: any) {
        console.error('Error sending Telegram dashboard:', error.response?.data || error.message);
    }
}
