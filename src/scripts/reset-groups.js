require('dotenv').config();
const axios = require('axios');
const { db, initDatabase } = require('../config/database');

const baseURL = process.env.EVOLUTION_URL || 'http://evolution-api:8080';
const instance = process.env.EVOLUTION_INSTANCE || 'promoflow';
const api = () => axios.create({
  baseURL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 15000,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForEvolution(maxMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      await api().get('/');
      return true;
    } catch (err) {
      if (err.response) return true;
      await sleep(2000);
    }
  }
  return false;
}

async function deleteInstance() {
  const client = api();
  try {
    await client.delete(`/instance/logout/${instance}`);
  } catch (e) {}
  try {
    await client.delete(`/instance/delete/${instance}`);
    console.log(`[reset] Instância WhatsApp "${instance}" removida (novo QR será gerado)`);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      console.log(`[reset] Instância WhatsApp "${instance}" não existia`);
    } else {
      console.warn(`[reset] Falha ao remover instância WhatsApp: ${status || err.message}`);
    }
  }
}

(async () => {
  initDatabase();
  const removed = db.prepare('DELETE FROM groups').run().changes;
  console.log(`[reset] ${removed} grupo(s) removido(s)`);

  const online = await waitForEvolution();
  if (!online) {
    console.warn('[reset] Evolution API indisponível; sessão do WhatsApp não foi removida');
    process.exit(0);
  }
  await deleteInstance();
  process.exit(0);
})().catch(err => {
  console.error('[reset] Erro ao zerar grupos:', err.message);
  process.exit(0);
});
