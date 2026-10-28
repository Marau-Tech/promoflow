const axios = require('axios');
const crypto = require('crypto');
const { db } = require('../config/database');
const logger = require('./logger');

const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

function clientId() { return process.env.ML_CLIENT_ID || ''; }
function clientSecret() { return process.env.ML_CLIENT_SECRET || ''; }

function redirectUri() {
  if (process.env.ML_REDIRECT_URI) return process.env.ML_REDIRECT_URI;
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, '')}/ml/callback`;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isConfigured() {
  return !!(clientId() && clientSecret());
}

function getStored() {
  try { return db.prepare('SELECT * FROM ml_auth WHERE id = 1').get() || null; } catch (e) { return null; }
}

function isConnected() {
  const row = getStored();
  return !!(row && row.access_token);
}

function saveTokens(data) {
  const expiresAt = new Date(Date.now() + ((data.expires_in || 21600) - 120) * 1000).toISOString();
  const refresh = data.refresh_token || getStored()?.refresh_token || null;
  db.prepare(`
    INSERT INTO ml_auth (id, access_token, refresh_token, expires_at, updated_at)
    VALUES (1, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(data.access_token, refresh, expiresAt);
}

function createAuthorizationUrl() {
  if (!isConfigured()) {
    const err = new Error('Configure ML_CLIENT_ID e ML_CLIENT_SECRET no arquivo .env.');
    logger.error('mercadolivre', 'OAuth não configurado', { redirect_uri: redirectUri() }, 'ml_auth');
    throw err;
  }
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());

  db.prepare('DELETE FROM ml_oauth_pending').run();
  db.prepare('INSERT INTO ml_oauth_pending (state, code_verifier) VALUES (?, ?)').run(state, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code, state) {
  const pending = db.prepare('SELECT * FROM ml_oauth_pending WHERE state = ?').get(state);
  if (!pending) {
    logger.warn('mercadolivre', 'Callback OAuth com estado inválido', { state_present: Boolean(state) }, 'ml_auth');
    throw new Error('Estado de autorização inválido ou expirado. Tente conectar novamente.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.code_verifier,
  });

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    timeout: 25000,
  });

  db.prepare('DELETE FROM ml_oauth_pending WHERE state = ?').run(state);
  saveTokens(res.data);
  logger.info('mercadolivre', 'Conta do Mercado Livre conectada', { scope: res.data.scope || null }, 'ml_auth');
  return res.data;
}

async function refreshAccessToken() {
  const row = getStored();
  if (!row?.refresh_token) throw new Error('Sem refresh token do Mercado Livre. Conecte novamente.');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: row.refresh_token,
  });

  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    timeout: 25000,
  });

  saveTokens(res.data);
  return res.data.access_token;
}

async function getAccessToken() {
  const row = getStored();
  if (!row?.access_token) return process.env.ML_ACCESS_TOKEN || process.env.ML_TOKEN || '';

  if (row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60000) {
    return row.access_token;
  }
  if (row.refresh_token && isConfigured()) {
    try { return await refreshAccessToken(); } catch (e) {
      logger.error('mercadolivre', 'Falha ao renovar token do Mercado Livre', logger.errorMeta(e), 'ml_auth');
    }
  }
  return row.access_token;
}

function disconnect() {
  try {
    db.prepare('DELETE FROM ml_auth WHERE id = 1').run();
    logger.info('mercadolivre', 'Conta do Mercado Livre desconectada', null, 'ml_auth');
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao desconectar conta do Mercado Livre', logger.errorMeta(e), 'ml_auth');
  }
}

module.exports = {
  isConfigured,
  isConnected,
  createAuthorizationUrl,
  exchangeCode,
  getAccessToken,
  refreshAccessToken,
  disconnect,
  redirectUri,
};
