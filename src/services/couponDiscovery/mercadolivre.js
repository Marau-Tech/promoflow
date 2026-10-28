const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../logger');

const http = axios.create({
  timeout: 25000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
  },
  validateStatus: s => s >= 200 && s < 400,
});

const SOURCES = [
  { url: 'https://www.pelando.com.br/cupons-de-descontos/mercado-livre', parser: 'pelando' },
  { url: 'https://www.cuponomia.com.br/desconto/mercado-livre', parser: 'cuponomia' },
];

function parseNumberBR(value = '') {
  const m = String(value).replace(/\./g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function parseDiscount(label = '') {
  const t = String(label).toLowerCase();
  const pct = t.match(/(\d{1,3})\s*%/);
  if (pct) return { discount_type: 'percent', discount_value: parseInt(pct[1], 10) };
  const fixed = t.match(/r\$\s*([0-9.,]+)/);
  if (fixed) return { discount_type: 'fixed', discount_value: parseNumberBR(fixed[1]) || 0 };
  return { discount_type: 'percent', discount_value: 0 };
}

function parseRules(text = '') {
  const t = String(text).toLowerCase();
  let min_purchase = null;
  let max_discount = null;

  const mMin = t.match(/(?:acima de|a partir de|m[íi]nimo|min\.)\s*r?\$?\s*([0-9.,]+)/);
  if (mMin) min_purchase = parseNumberBR(mMin[1]);

  const mMax = t.match(/(?:desconto\s+m[áa]ximo|desconto\s+m[áa]x|m[áa]ximo\s+limitado\s+a|m[áa]ximo|limitado\s+a|max\.?)\s*(?:de\s*)?r?\$?\s*([0-9.,]+)/);
  if (mMax) max_discount = parseNumberBR(mMax[1]);

  return { min_purchase, max_discount };
}

function couponFrom({ code, title, description, label, rulesText, url }) {
  const discount = parseDiscount(label || title);
  const rules = parseRules(`${rulesText} ${title}`);

  if (!discount.discount_value) return null;

  return {
    code,
    title: title || `Cupom ${code}`,
    description: rulesText || null,
    rules_text: [label, rulesText].filter(Boolean).join(' — ').substring(0, 1000) || null,
    discount_type: discount.discount_type,
    discount_value: discount.discount_value,
    min_purchase: rules.min_purchase,
    max_discount: rules.max_discount,
    terms_url: url,
    source_url: url,
  };
}

function parseCuponomia($, url, expired = []) {
  const coupons = [];

  $('li.item[data-type="code"], .js-coupon-list-item').each((_, el) => {
    const node = $(el);
    const code = node.find('.js-itemCode, [class*="item-code-link"]').first().text().trim().toUpperCase();
    const title = node.find('.js-itemTitle, .item-title h3, h3').first().text().trim();

    // Esgotados vêm sem o código no HTML; o título identifica o cupom já salvo.
    if (node.hasClass('expired-item')) {
      expired.push({ code: /^[A-Z0-9]{4,20}$/.test(code) ? code : null, title: title || null, source: url });
      return;
    }
    if (!code || !/^[A-Z0-9]{4,20}$/.test(code)) return;

    const rawRules = node.find('.item-desc, .coupon-info-complement').first().text().replace(/\s+/g, ' ').trim();
    const rulesText = rawRules
      .replace(/Verificado\s+(hoje|ontem|agora)/gi, '')
      .replace(/\d+\s+usados?\s+(hoje|ontem|agora)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const label = node.find('.smallTitle-content, .smallTitle').first().text().replace(/\s+/g, ' ').trim();

    const coupon = couponFrom({ code, title, description: rulesText, label, rulesText, url });
    if (coupon) coupons.push(coupon);
  });

  return coupons;
}

function parsePelando($, url, expired = []) {
  const coupons = [];

  $('article.card').each((_, el) => {
    const node = $(el);
    const codeEl = node.find('[data-copy-code]').first();
    if (!codeEl.length) return;

    const code = String(codeEl.attr('data-copy-code') || codeEl.text() || '').trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,20}$/.test(code)) return;

    const cta = node.find('a.card__cta').first();
    const status = String(cta.attr('data-status') || '').toLowerCase();
    const title = node.find('h2.card__title').first().text().replace(/\s+/g, ' ').trim();
    if (status === 'expired') {
      expired.push({ code, title: title || null, source: url });
      return;
    }
    if (status && status !== 'active') return;

    const description = node.find('p.card__description').first().text().replace(/\s+/g, ' ').trim();

    const coupon = couponFrom({ code, title, description, rulesText: description, url });
    if (coupon) coupons.push(coupon);
  });

  return coupons;
}

async function fetchSource(source, expired) {
  const res = await http.get(source.url);
  const $ = cheerio.load(res.data || '');
  if (source.parser === 'pelando') return parsePelando($, source.url, expired);
  return parseCuponomia($, source.url, expired);
}

/** Devolve os cupons ativos e os que as fontes marcam como esgotados/expirados. */
async function discover() {
  const all = [];
  const expired = [];
  for (const source of SOURCES) {
    try {
      const list = await fetchSource(source, expired);
      all.push(...list);
    } catch (e) {
      logger.error('cupons_ml', 'Falha ao buscar cupons na fonte', logger.errorMeta(e, { url: source.url }), 'coupon_discovery');
      console.error('[CouponDiscovery] Falha em', source.url, e.message);
    }
  }

  const map = new Map();
  for (const c of all) {
    const current = map.get(c.code);
    if (!current || Number(c.discount_value) > Number(current.discount_value)) map.set(c.code, c);
  }
  const result = Array.from(map.values());
  // Um código ativo em uma fonte prevalece sobre o "esgotado" de outra.
  const exhausted = expired.filter(e => !e.code || !map.has(e.code));
  logger.info('cupons_ml', 'Busca de cupons concluída', {
    found: all.length,
    unique: result.length,
    expired: exhausted.length,
    sources: SOURCES.length,
  }, 'coupon_discovery');
  return { coupons: result, expired: exhausted };
}

module.exports = { discover };
