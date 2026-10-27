const QRCode = require('qrcode');

let Client, LocalAuth, MessageMedia;
let client = null;
let state = { status: 'disconnected', qr: null };

function init() {
  ({ Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'));

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/wa-session' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', async qr => {
    state = { status: 'qr', qr: await QRCode.toDataURL(qr) };
    console.log('[WhatsApp] Escaneie o QR Code na página /grupos');
  });
  client.on('ready', () => { state = { status: 'ready', qr: null }; console.log('[WhatsApp] Conectado'); });
  client.on('disconnected', () => { state = { status: 'disconnected', qr: null }; console.log('[WhatsApp] Desconectado'); });

  client.initialize().catch(err => console.error('[WhatsApp] Falha ao iniciar:', err.message));
}

function getState() { return state; }

function ensureReady() {
  if (!client || state.status !== 'ready') throw new Error('WhatsApp não está conectado. Acesse a página Grupos e escaneie o QR Code.');
}

async function listGroups() {
  ensureReady();
  const chats = await client.getChats();
  return chats.filter(c => c.isGroup).map(c => ({ external_id: c.id._serialized, name: c.name, platform: 'whatsapp' }));
}

async function sendPromotion(groupId, { message, image_url }) {
  ensureReady();
  if (image_url) {
    try {
      const media = await MessageMedia.fromUrl(image_url, { unsafeMime: true });
      await client.sendMessage(groupId, media, { caption: message });
      return;
    } catch (err) {
      console.warn('[WhatsApp] Falha ao baixar imagem, enviando só texto:', err.message);
    }
  }
  await client.sendMessage(groupId, message);
}

async function logout() {
  if (client) await client.logout();
  state = { status: 'disconnected', qr: null };
}

module.exports = { init, getState, listGroups, sendPromotion, logout };
