const axios = require('axios');
const { getConfig } = require('./autoDiscovery/config');
const logger = require('./logger');

const SHORT_LINK = /^https?:\/\/(?:www\.)?meli\.la\//i;
const ML_HOST = /(^|\.)mercadoli(?:vre|bre)\.com(?:\.br)?$/i;
const LINKBUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const CREATE_LINK_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';
const TRACKING_PARAMS = ['matt_tool', 'matt_word', 'matt_source', 'matt_campaign', 'forceInApp', 'ref', 'tracking_id'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isShortLink(url = '') {
  return SHORT_LINK.test(String(url).trim());
}

function isAffiliateLink(url = '') {
  return isShortLink(url) || /[?&]matt_word=/i.test(String(url));
}

function isMercadoLivreUrl(url = '') {
  try { return ML_HOST.test(new URL(String(url).trim()).hostname); } catch (e) { return false; }
}

function credentials(cfg = getConfig()) {
  return {
    tag: String(cfg.affiliate_tag || '').trim(),
    tool: String(cfg.affiliate_tool || '').trim(),
    cookies: String(cfg.ml_session_cookies || '').trim(),
  };
}

/** Link do produto sem rastreamentos anteriores nem fragmento (#...). */
function cleanProductUrl(url) {
  const u = new URL(String(url).trim());
  TRACKING_PARAMS.forEach(p => u.searchParams.delete(p));
  u.hash = '';
  return u.toString();
}

/** Link do produto com a etiqueta de afiliado (matt_word/matt_tool). */
function trackedUrl(url, cfg = getConfig()) {
  const { tag, tool } = credentials(cfg);
  if (!tag || !tool || !isMercadoLivreUrl(url)) return null;
  const u = new URL(cleanProductUrl(url));
  u.searchParams.set('matt_word', tag);
  u.searchParams.set('matt_tool', tool);
  return u.toString();
}

/**
 * Link usado no CTA das promoções, em ordem de preferência: link de afiliado
 * salvo na promoção, link do produto com a etiqueta (matt_word/matt_tool) e,
 * por último, o link padrão configurado.
 */
function linkFor(promotion = {}) {
  for (const candidate of [promotion.affiliate_url, promotion.url]) {
    const link = String(candidate || '').trim();
    if (link && isAffiliateLink(link)) return link;
  }

  const direct = String(promotion.url || '').trim();
  const cfg = getConfig();
  const tracked = direct ? trackedUrl(direct, cfg) : null;
  if (tracked) return tracked;

  const configured = String(cfg.affiliate_url || '').trim();
  return configured || direct;
}

function csrfFrom(html = '') {
  const text = String(html);
  const patterns = [
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)/i,
    /"csrfToken"\s*:\s*"([^"]+)"/i,
    /"_csrf"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Gera links meli.la pela mesma API interna que o Linkbuilder do painel de
 * afiliados usa. Autentica com os cookies da sessão logada no Mercado Livre.
 */
async function createShortLinks(urls, cfg = getConfig()) {
  const { tag, cookies } = credentials(cfg);
  if (!tag) throw new Error('Informe a etiqueta de afiliado (matt_word) em /descobrir.');
  if (!cookies) throw new Error('Informe os cookies da sessão do Mercado Livre em /descobrir.');

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'pt-BR,pt;q=0.9',
    Cookie: cookies,
  };

  const page = await axios.get(LINKBUILDER_URL, {
    headers: { ...headers, Accept: 'text/html' },
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: s => s >= 200 && s < 400,
  });
  if (page.status >= 300) {
    throw new Error('Sessão do Mercado Livre expirada: atualize os cookies em /descobrir.');
  }
  const csrf = csrfFrom(page.data);

  const res = await axios.post(CREATE_LINK_URL, { urls, tag }, {
    headers: {
      ...headers,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://www.mercadolivre.com.br',
      Referer: LINKBUILDER_URL,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Mercado Livre recusou a criação do link (HTTP ${res.status}). Atualize os cookies da sessão.`);
  }
  if (res.status !== 200 || !res.data) {
    throw new Error(`createLink respondeu HTTP ${res.status}`);
  }
  const items = Array.isArray(res.data.urls) ? res.data.urls : [];
  return urls.map((_, i) => items[i]?.short_url || null);
}

/**
 * Garante um meli.la para a promoção do Mercado Livre e o salva nela.
 * Sem credenciais ou em caso de falha, devolve null e o envio segue com o
 * link de linkFor().
 */
async function ensureShortLink(promotion = {}) {
  if (isShortLink(promotion.affiliate_url)) return promotion.affiliate_url;
  if (isShortLink(promotion.url)) return promotion.url;
  if (promotion.store !== 'mercadolivre' || !isMercadoLivreUrl(promotion.url)) return null;

  const cfg = getConfig();
  const { tag, cookies } = credentials(cfg);
  if (!tag || !cookies) return null;

  try {
    const [short] = await createShortLinks([cleanProductUrl(promotion.url)], cfg);
    if (!short) throw new Error('createLink não devolveu o meli.la');
    if (promotion.id) require('../models/Promotion').setAffiliateUrl(promotion.id, short);
    logger.info('promocoes', 'Link meli.la gerado', { promotion_id: promotion.id, short_url: short }, 'affiliate');
    return short;
  } catch (e) {
    logger.once(`affiliate-short-link-${e.message}`, 600000, 'warn', 'promocoes',
      'Não foi possível gerar o meli.la; usando link com etiqueta',
      logger.errorMeta(e, { promotion_id: promotion.id }), 'affiliate');
    return null;
  }
}

module.exports = {
  linkFor,
  isAffiliateLink,
  isShortLink,
  isMercadoLivreUrl,
  trackedUrl,
  cleanProductUrl,
  createShortLinks,
  ensureShortLink,
};
