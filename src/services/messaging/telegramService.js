const axios = require('axios');
const { toTelegramHtml } = require('../templateEngine');

function api(method) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado no .env');
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function sendPromotion(chatId, { message, image_url }) {
  const caption = toTelegramHtml(message);
  if (image_url && caption.length <= 1024) {
    await axios.post(api('sendPhoto'), { chat_id: chatId, photo: image_url, caption, parse_mode: 'HTML' });
  } else {
    await axios.post(api('sendMessage'), { chat_id: chatId, text: caption, parse_mode: 'HTML' });
  }
}

async function discoverChats() {
  const { data } = await axios.get(api('getUpdates'), { params: { limit: 100 } });
  const chats = new Map();
  (data.result || []).forEach(u => {
    const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
    if (chat && ['group', 'supergroup', 'channel'].includes(chat.type)) {
      chats.set(String(chat.id), { external_id: String(chat.id), name: chat.title, platform: 'telegram' });
    }
  });
  return [...chats.values()];
}

module.exports = { sendPromotion, discoverChats };
