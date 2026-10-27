const axios = require('axios');

const http = () => axios.create({
  baseURL: process.env.EVOLUTION_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 30000,
});
const instance = () => process.env.EVOLUTION_INSTANCE || 'promoflow';

const QR_TTL_MS = 40000;   // tempo de validade aproximado do QR gerado pela Evolution

let state = { status: 'disconnected', qr: null };   // disconnected | qr | ready
let lastQrAt = 0;

/** Garante que a instância existe e começa a monitorar o estado. Tenta até a Evolution responder. */
async function init() {
  try {
    await http().post('/instance/create', { instanceName: instance(), qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    console.log('[WhatsApp] Instância criada na Evolution API');
  } catch (err) {
    const status = err.response?.status;
    if (status !== 403) {   // 403 = instância já existe, segue normalmente
      const msg = err.response?.data?.response?.message?.[0] || err.message;
      console.warn(`[WhatsApp] Evolution API indisponível (${msg}). Nova tentativa em 5s...`);
      setTimeout(() => init().catch(() => {}), 5000);
      return;
    }
  }
  await refreshState().catch(err => console.warn('[WhatsApp] Falha ao consultar estado:', err.message));
  setInterval(() => refreshState().catch(() => {}), 5000);
  console.log('[WhatsApp] Monitorando instância', instance());
}

/** Consulta o estado da conexão; só pede QR novo quando não há um ou quando o atual expirou. */
async function refreshState() {
  const { data } = await http().get(`/instance/connectionState/${instance()}`);
  const st = data?.instance?.state;

  if (st === 'open') {
    if (state.status !== 'ready') console.log('[WhatsApp] Conectado');
    state = { status: 'ready', qr: null };
    return;
  }

  const stale = Date.now() - lastQrAt > QR_TTL_MS;
  if (state.status !== 'qr' || stale) {
    const { data: conn } = await http().get(`/instance/connect/${instance()}`);
    if (conn?.base64) {
      state = { status: 'qr', qr: conn.base64 };
      lastQrAt = Date.now();
    } else {
      state = { status: 'disconnected', qr: null };
    }
  }
}

function getState() { return state; }

function ensureReady() {
  if (state.status !== 'ready') throw new Error('WhatsApp não está conectado. Acesse a página Grupos e escaneie o QR Code.');
}

async function listGroups() {
  ensureReady();
  const { data } = await http().get(`/group/fetchAllGroups/${instance()}`, { params: { getParticipants: false } });
  return (data || []).map(g => ({ external_id: g.id, name: g.subject, platform: 'whatsapp' }));
}

async function sendPromotion(groupId, { message, image_url }) {
  ensureReady();
  if (image_url) {
    try {
      await http().post(`/message/sendMedia/${instance()}`, { number: groupId, mediatype: 'image', media: image_url, caption: message });
      return;
    } catch (err) {
      console.warn('[WhatsApp] Falha ao enviar imagem, enviando só texto:', err.response?.data?.message || err.message);
    }
  }
  await http().post(`/message/sendText/${instance()}`, { number: groupId, text: message });
}

async function logout() {
  try { await http().delete(`/instance/logout/${instance()}`); } catch (_) { /* pode já estar deslogada */ }
  try { await http().delete(`/instance/delete/${instance()}`); } catch (_) { /* pode já não existir */ }
  state = { status: 'disconnected', qr: null };
  lastQrAt = 0;
  await http().post('/instance/create', { instanceName: instance(), qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  await refreshState().catch(() => {});
}

module.exports = { init, getState, listGroups, sendPromotion, logout };