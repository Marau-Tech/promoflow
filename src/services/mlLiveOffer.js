const axios = require('axios');
const logger = require('./logger');

const http = axios.create({
  timeout: 20000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cache-Control': 'no-cache',
  },
  validateStatus: s => s >= 200 && s < 400,
});

const LIVE_LINK = /^https?:\/\/(?:www\.)?(?:meli\.la\/|mercadolivre\.com\.br\/social\/)/i;

function canCheck(url = '') {
  return LIVE_LINK.test(String(url).trim());
}

/** Extrai todos os arrays "polycards" embutidos no HTML da página social do afiliado. */
function extractPolycards(html = '') {
  const cards = [];
  const marker = '"polycards":[';
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    from = at + marker.length;
    try {
      const { value } = rawDecode(html, at + marker.length - 1);
      if (Array.isArray(value)) cards.push(...value);
    } catch (e) {
      // Um bloco malformado não deve impedir a leitura dos demais.
    }
  }
  return cards;
}

/** Lê um valor JSON começando em `start` sem precisar saber onde ele termina. */
function rawDecode(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
    }
  }
  throw new Error('JSON incompleto');
}

function collectTexts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'text' && typeof value === 'string') out.push(value);
    else if (typeof value === 'object') collectTexts(value, out);
  }
  return out;
}

function parseCouponText(text = '') {
  const t = String(text);
  const pct = t.match(/(\d{1,3})\s*%/);
  if (pct) return { discount_type: 'percent', discount_value: Number(pct[1]) };
  const fixed = t.match(/R\$\s*([0-9.]+(?:,\d{1,2})?)/i);
  if (fixed) return { discount_type: 'fixed', discount_value: Number(fixed[1].replace(/\./g, '').replace(',', '.')) };
  return null;
}

/** Cupom exibido pelo próprio Mercado Livre no card do produto (componente "coupons"). */
function couponOf(card) {
  const component = (card.components || []).find(c => /coupon/i.test(`${c.type} ${c.id}`));
  if (!component) return null;
  const text = collectTexts(component[component.type] || component).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { text, ...(parseCouponText(text) || {}) };
}

function offerOf(card) {
  const md = card.metadata || {};
  const priceComp = (card.components || []).find(c => c.type === 'price')?.price;
  const price = Number(priceComp?.current_price?.value);
  if (!priceComp || !(price > 0)) return null;

  const campaigns = (md.tracks?.price?.promotions || []).flatMap(p => p.campaigns || []);
  const pix = campaigns.some(c => /pix/i.test(c.type))
    || /no\s+pix/i.test(priceComp.discount_label?.text || '');

  // Com desconto no Pix, o ML mostra "ou R$ X em N vezes" — X é o preço sem Pix.
  const totalWithoutPix = (priceComp.installments?.values || [])
    .find(v => v.key === 'price_total')?.price?.value;

  const title = (card.components || []).find(c => c.type === 'title')?.title?.text || null;
  const previous = Number(priceComp.previous_price?.value);

  return {
    item_id: md.id || null,
    product_id: md.product_id || null,
    title,
    price,
    original_price: previous > price ? previous : null,
    pix,
    price_without_pix: pix && Number(totalWithoutPix) > price ? Number(totalWithoutPix) : null,
    coupon: couponOf(card),
  };
}

function sameProduct(card, sku) {
  if (!sku) return true;
  const id = String(sku).toUpperCase();
  const md = card.metadata || {};
  return [md.id, md.product_id].some(v => v && String(v).toUpperCase() === id);
}

/**
 * Consulta o link de afiliado (meli.la) e devolve o preço que o comprador vê agora:
 * preço atual, se o desconto vale só no Pix e se o ML exibe algum cupom no produto.
 * Retorna null quando não dá para confirmar que o card é do produto da promoção.
 */
async function fetchLiveOffer(url, { sku = null } = {}) {
  if (!canCheck(url)) return null;
  const res = await http.get(url);
  const cards = extractPolycards(String(res.data || ''));
  if (!cards.length) return null;

  // O primeiro card é o produto em destaque do link; os demais são recomendações.
  const card = cards[0];
  if (!sameProduct(card, sku)) {
    logger.warn('promocoes', 'Link de afiliado aponta para outro produto', {
      url,
      sku,
      featured: cards[0]?.metadata?.product_id || cards[0]?.metadata?.id || null,
    }, 'ml_live_offer');
    return null;
  }
  return offerOf(card);
}

module.exports = { canCheck, fetchLiveOffer, extractPolycards, offerOf, parseCouponText };
