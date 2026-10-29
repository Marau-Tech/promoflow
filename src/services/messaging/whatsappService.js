const axios = require('axios');
const logger = require('../logger');

const http = () => axios.create({
  baseURL: process.env.EVOLUTION_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 30000,
});
const instance = () => process.env.EVOLUTION_INSTANCE || 'promoflow';

const QR_TTL_MS = 40000;   // tempo de validade aproximado do QR gerado pela Evolution
const QR_RETRY_MS = 15000;
const MEDIA_ATTEMPTS = 2;
const MEDIA_RETRY_DELAY_MS = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mediaFileName(mimetype = '') {
  if (/png/i.test(mimetype)) return 'promocao.png';
  if (/webp/i.test(mimetype)) return 'promocao.webp';
  return 'promocao.jpg';
}

async function downloadMedia(url) {
  const { data, headers } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PromoFlow/1.0)' },
  });
  const mimetype = String(headers['content-type'] || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  return { base64: Buffer.from(data).toString('base64'), mimetype };
}

async function sendMediaWithRetry(payload, groupId) {
  let lastError;
  for (let attempt = 1; attempt <= MEDIA_ATTEMPTS; attempt++) {
    try {
      await http().post(`/message/sendMedia/${instance()}`, payload);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MEDIA_ATTEMPTS) {
        logger.warn('whatsapp', 'Falha temporária ao enviar imagem; tentando novamente', logger.errorMeta(err, {
          group_id: groupId,
          attempt,
        }), 'whatsapp');
        await sleep(MEDIA_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

let state = { status: 'disconnected', qr: null };   // disconnected | connecting | qr | ready
let lastQrAt = 0;
let lastConnectAt = 0;
let refreshing = false;

/** Garante que a instância existe e começa a monitorar o estado. Tenta até a Evolution responder. */
async function init() {
  try {
    await http().post('/instance/create', { instanceName: instance(), qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    logger.info('whatsapp', 'Instância criada na Evolution API', { instance: instance() }, 'whatsapp');
    console.log('[WhatsApp] Instância criada na Evolution API');
  } catch (err) {
    const status = err.response?.status;
    if (status !== 403) {   // 403 = instância já existe, segue normalmente
      const msg = err.response?.data?.response?.message?.[0] || err.message;
      logger.once('whatsapp-init-unavailable', 30000, 'error', 'whatsapp',
        'Evolution API indisponível', logger.errorMeta(err, { instance: instance() }), 'whatsapp');
      console.warn(`[WhatsApp] Evolution API indisponível (${msg}). Nova tentativa em 5s...`);
      setTimeout(() => init().catch(() => {}), 5000);
      return;
    }
  }
  await refreshState().catch(err => {
    logger.once('whatsapp-state', 60000, 'warn', 'whatsapp',
      'Falha ao consultar estado da conexão', logger.errorMeta(err, { instance: instance() }), 'whatsapp');
    console.warn('[WhatsApp] Falha ao consultar estado:', err.message);
  });
  setInterval(() => refreshState().catch(err => {
    logger.once('whatsapp-state', 60000, 'warn', 'whatsapp',
      'Falha ao consultar estado da conexão', logger.errorMeta(err, { instance: instance() }), 'whatsapp');
  }), 5000);
  logger.info('whatsapp', 'Monitoramento da instância iniciado', { instance: instance() }, 'whatsapp');
  console.log('[WhatsApp] Monitorando instância', instance());
}

/** Consulta o estado da conexão; só pede QR novo quando não há um ou quando o atual expirou. */
async function refreshState() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { data } = await http().get(`/instance/connectionState/${instance()}`);
    const st = data?.instance?.state;

    if (st === 'open') {
      if (state.status !== 'ready') {
        logger.info('whatsapp', 'WhatsApp conectado', { instance: instance() }, 'whatsapp');
        console.log('[WhatsApp] Conectado');
      }
      state = { status: 'ready', qr: null };
      return;
    }

    if (state.status === 'ready' && st !== 'open') {
      logger.warn('whatsapp', 'WhatsApp desconectado', { instance: instance(), state: st }, 'whatsapp');
    }

    if (st === 'connecting') {
      const qrStale = Date.now() - lastQrAt > QR_TTL_MS;
      const connectStale = Date.now() - lastConnectAt > QR_RETRY_MS;
      if ((!state.qr || qrStale) && connectStale) {
        lastConnectAt = Date.now();
        try {
          const { data: conn } = await http().get(`/instance/connect/${instance()}`);
          if (conn?.base64) {
            state = { status: 'qr', qr: conn.base64 };
            lastQrAt = Date.now();
            return;
          }
        } catch (err) {
          logger.once('whatsapp-qr', 60000, 'warn', 'whatsapp',
            'Falha ao obter QR Code', logger.errorMeta(err, { instance: instance() }), 'whatsapp');
        }
      }
      if (state.qr && Date.now() - lastQrAt <= QR_TTL_MS) {
        state = { status: 'qr', qr: state.qr };
      } else {
        state = { status: 'connecting', qr: null };
      }
      return;
    }

    const stale = Date.now() - lastQrAt > QR_TTL_MS;
    const connectStale = Date.now() - lastConnectAt > QR_RETRY_MS;
    if (st === 'close' && connectStale && (state.status !== 'qr' || stale)) {
      lastConnectAt = Date.now();
      const { data: conn } = await http().get(`/instance/connect/${instance()}`);
      const connState = conn?.instance?.state;
      if (conn?.base64) {
        state = { status: 'qr', qr: conn.base64 };
        lastQrAt = Date.now();
      } else if (connState === 'open' || connState === 'connecting') {
        state = { status: 'connecting', qr: null };
      } else {
        state = { status: 'disconnected', qr: null };
      }
    }
  } finally {
    refreshing = false;
  }
}

function getState() { return state; }

function ensureReady() {
  if (state.status !== 'ready') throw new Error('WhatsApp não está conectado. Acesse a página Grupos e escaneie o QR Code.');
}

async function listGroups() {
  try {
    ensureReady();
    const { data } = await http().get(`/group/fetchAllGroups/${instance()}`, { params: { getParticipants: false } });
    const groups = (data || []).map(g => ({ external_id: g.id, name: g.subject, platform: 'whatsapp' }));
    logger.info('whatsapp', 'Grupos do WhatsApp importados', { count: groups.length }, 'whatsapp');
    return groups;
  } catch (e) {
    logger.error('whatsapp', 'Falha ao importar grupos do WhatsApp', logger.errorMeta(e), 'whatsapp');
    throw e;
  }
}

async function sendPromotion(groupId, { message, image_url }) {
  ensureReady();
  if (image_url) {
    const attempts = [];

    try {
      await sendMediaWithRetry({
        number: groupId,
        mediatype: 'image',
        media: image_url,
        caption: message,
      }, groupId);
      return;
    } catch (err) {
      attempts.push(err);
    }

    try {
      const media = await downloadMedia(image_url);
      await sendMediaWithRetry({
        number: groupId,
        mediatype: 'image',
        mimetype: media.mimetype,
        fileName: mediaFileName(media.mimetype),
        media: media.base64,
        caption: message,
      }, groupId);
      return;
    } catch (err) {
      attempts.push(err);
    }

    const err = attempts[attempts.length - 1] || attempts[0];
    logger.warn('whatsapp', 'Falha ao enviar imagem; enviando somente texto',
      logger.errorMeta(err, { group_id: groupId, attempts: attempts.length }), 'whatsapp');
    console.warn('[WhatsApp] Falha ao enviar imagem, enviando só texto:', err.response?.data?.message || err.message);
  }
  await http().post(`/message/sendText/${instance()}`, { number: groupId, text: message });
}

async function logout() {
  try { await http().delete(`/instance/logout/${instance()}`); } catch (_) { /* pode já estar deslogada */ }
  try { await http().delete(`/instance/delete/${instance()}`); } catch (_) { /* pode já não existir */ }
  state = { status: 'disconnected', qr: null };
  lastQrAt = 0;
  lastConnectAt = 0;
  logger.info('whatsapp', 'WhatsApp desconectado pelo usuário', { instance: instance() }, 'whatsapp');
  await http().post('/instance/create', { instanceName: instance(), qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  await refreshState().catch(() => {});
}

module.exports = { init, getState, listGroups, sendPromotion, logout };