const { scrapeProduct } = require('./scraper');
const { storeLabel } = require('./scraper/storeDetector');
const templateEngine = require('./templateEngine');
const Promotion = require('../models/Promotion');
const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const Coupon = require('../models/Coupon');
const { isCouponAvailable, applyCoupon } = require('./couponDiscovery');
const { fetchLiveOffer } = require('./mlLiveOffer');
const logger = require('./logger');
const { couponMatchRank } = require('./couponMatcher');
const affiliate = require('./affiliate');
const { db } = require('../config/database');

const MAX_LINKS = 30;

const HOOKS = [
  '🔥 *QUEIMOU PREÇO!*',
  '⚡ *OFERTA RELÂMPAGO!*',
  '💥 *PREÇO IRRESISTÍVEL!*',
  '🎯 *MELHOR PREÇO HOJE!*',
  '🚨 *CORRE QUE VAI ACABAR!*',
  '💸 *VALE MUITO A PENA!*',
  '⭐ *OFERTA QUENTE!*',
  '🏷️ *PREÇO ESPECIAL!*',
  '💚 *DICA PRA ECONOMIZAR!*',
  '⏰ *SÓ POR HOJE!*',
  '✨ *ACHADO DO DIA!*',
  '🚀 *PROMOÇÃO DO DIA!*',
];

const CTAS = [
  '🔗 *Garanta o seu:*',
  '🛒 *Clica e garante:*',
  '⚡ *Corre pra garantir:*',
  '💥 *Pega o seu antes que acabe:*',
  '🎯 *Link direto:*',
  '🚀 *Garantir agora:*',
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomizeText(msg = '') {
  let text = String(msg);
  const hook = pick(HOOKS);
  const cta = pick(CTAS);
  text = text.replace(/🚀\s*\*OFERTA IMPERDÍVEL!\*\s*🚀/i, hook);
  text = text.replace(/🔥\s*\*OFERTA IMPERDÍVEL!\*\s*🔥/i, hook);
  text = text.replace(/OFERTA IMPERDÍVEL/gi, hook.replace(/\*/g, '').trim());
  text = text.replace(/🔗\s*\*Garanta o seu:\*/i, cta);
  return text;
}

function bestMlCoupon(price, promotion = null) {
  if (!price || !promotion) return null;
  try {
    const rows = db.prepare('SELECT * FROM ml_coupons WHERE active = 1').all();
    let best = null;
    for (const c of rows) {
      const rank = couponMatchRank(c, promotion);
      if (!rank) continue;
      const check = isCouponAvailable(c, price);
      if (!check.applied) continue;
      const candidate = { ...c, ...check, match_rank: rank };
      const isMoreSpecific = !best || rank > best.match_rank;
      const isBetterPrice = best && rank === best.match_rank && check.price_with_coupon < best.price_with_coupon;
      const isTieBreaker = best
        && rank === best.match_rank
        && check.price_with_coupon === best.price_with_coupon
        && String(c.code) < String(best.code);
      if (isMoreSpecific || isBetterPrice || isTieBreaker) {
        best = candidate;
      }
    }
    return best;
  } catch (e) {
    return null;
  }
}

function couponRecordFor(mlCoupon) {
  if (!mlCoupon?.code) return null;
  try {
    return db.prepare('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?)').get(mlCoupon.code) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Com `live` (resultado da checagem no link de afiliado, ou null quando não foi
 * possível checar), cupons de terceiros não são usados: só entra o cupom que o
 * próprio Mercado Livre exibe no produto.
 */
function buildMessage(promotion, live) {
  if (live !== undefined && promotion.store === 'mercadolivre') return buildVerifiedMessage(promotion, live);

  const template = (promotion.template_id && Template.find(promotion.template_id)) || Template.getDefault();
  const coupon = promotion.coupon_id ? Coupon.find(promotion.coupon_id) : null;
  const slogan = promotion.slogan_id ? Slogan.find(promotion.slogan_id) : null;

  let mlCoupon = null;
  if (promotion.store === 'mercadolivre' && !coupon) {
    mlCoupon = bestMlCoupon(promotion.price, promotion);
  }

  let activeCoupon = coupon || mlCoupon;
  let couponUsable = false;
  if (promotion.price && activeCoupon) {
    const check = isCouponAvailable(activeCoupon, promotion.price);
    couponUsable = check.applied;
    if (couponUsable) activeCoupon = { ...activeCoupon, ...check };
  }

  const link = affiliate.linkFor(promotion);
  const ctx = templateEngine.buildContext({
    promotion: { ...promotion, url: link },
    coupon: couponUsable ? activeCoupon : null,
    slogan,
    storeLabel: storeLabel(promotion.store),
  });
  let rendered = randomizeText(templateEngine.render(template.content, ctx));

  if (mlCoupon && mlCoupon.applied && Number(mlCoupon.price_with_coupon) < Number(promotion.price)) {
    if (!/cupom/i.test(rendered)) {
      rendered += `\n\nUse o Cupom: *${mlCoupon.code}* 🎟️ + Selecione Pix`;
    }
  }

  return rendered;
}

function buildVerifiedMessage(promotion, live) {
  const template = (promotion.template_id && Template.find(promotion.template_id)) || Template.getDefault();
  const slogan = promotion.slogan_id ? Slogan.find(promotion.slogan_id) : null;
  const current = live
    ? { ...promotion, price: live.price, original_price: live.original_price ?? promotion.original_price }
    : promotion;

  let couponLine = null;
  let finalPrice = current.price;
  if (live?.coupon) {
    const check = live.coupon.discount_value ? applyCoupon(current.price, live.coupon) : null;
    if (check?.applied && check.price_with_coupon < current.price) {
      finalPrice = check.price_with_coupon;
      couponLine = `🎟️ Ative o cupom de *${live.coupon.text}* na página do produto`;
    } else {
      couponLine = `🎟️ ${live.coupon.text} na página do produto`;
    }
  }

  const ctx = templateEngine.buildContext({
    promotion: { ...current, price: finalPrice, url: affiliate.linkFor(promotion) },
    coupon: null,
    slogan,
    storeLabel: storeLabel(promotion.store),
    pix: Boolean(live?.pix) && finalPrice === current.price,
  });
  let rendered = randomizeText(templateEngine.render(template.content, ctx));
  if (couponLine) rendered += `\n\n${couponLine}`;
  return rendered;
}

/**
 * Revalida preço e cupom no momento do envio consultando o link de afiliado:
 * cupom que o Mercado Livre não exibe no produto não é divulgado, e desconto
 * que só vale no Pix é informado como tal.
 */
async function prepareForSend(promotion) {
  const prepared = { ...promotion };
  if (prepared.store !== 'mercadolivre') {
    prepared.message = buildMessage(prepared);
    return prepared;
  }

  const short = await affiliate.ensureShortLink(prepared);
  if (short) prepared.affiliate_url = short;

  const link = affiliate.linkFor(prepared);
  let live = null;
  try {
    live = await fetchLiveOffer(link, { sku: prepared.sku });
  } catch (e) {
    logger.warn('promocoes', 'Não foi possível conferir preço/cupom no Mercado Livre', logger.errorMeta(e, {
      promotion_id: prepared.id,
      url: link,
    }), 'promotion_service');
  }

  if (live) {
    prepared.price = live.price;
    if (live.original_price) prepared.original_price = live.original_price;
  }
  prepared.message = buildMessage(prepared, live);
  logger.info('promocoes', 'Oferta conferida antes do envio', {
    promotion_id: prepared.id,
    checked: Boolean(live),
    price: live?.price ?? prepared.price,
    price_source: live?.price_source ?? null,
    item_id: live?.item_id ?? null,
    product_id: live?.product_id ?? null,
    pix: live?.pix ?? null,
    ml_coupon: live?.coupon?.text ?? null,
  }, 'promotion_service');
  return prepared;
}

function createFromData(data, templateId = null) {
  const template = (templateId && Template.find(templateId)) || Template.getDefault();
  const slogan = Slogan.random();
  const autoCoupon = couponRecordFor(bestMlCoupon(data.price, data));
  const draft = {
    ...data,
    template_id: template.id,
    slogan_id: slogan?.id || null,
    coupon_id: autoCoupon?.id || null,
  };
  draft.message = buildMessage(draft);
  return enrich(Promotion.create(draft));
}

async function generateFromLinks({ links, templateId, storeHint = null, sloganMode = 'random' }) {
  const unique = [...new Set(links.map(l => l.trim()).filter(Boolean))].slice(0, MAX_LINKS);
  return Promise.all(unique.map(async url => {
    try {
      const data = await scrapeProduct(url);
      if (storeHint) data.store = storeHint;
      return { ok: true, promotion: createFromData(data, templateId) };
    } catch (err) {
      return { ok: false, url, error: err.message };
    }
  }));
}

function updatePromotion(id, fields) {
  const current = Promotion.find(id);
  if (!current) throw Object.assign(new Error('Promoção não encontrada'), { status: 404 });

  const merged = {
    ...current,
    ...fields,
    price: fields.price !== undefined && fields.price !== '' ? Number(fields.price) : current.price,
    original_price: fields.original_price !== undefined ? (fields.original_price === '' ? null : Number(fields.original_price)) : current.original_price,
    coupon_id: fields.coupon_id !== undefined ? (Number(fields.coupon_id) || null) : current.coupon_id,
    slogan_id: fields.slogan_id !== undefined ? (Number(fields.slogan_id) || null) : current.slogan_id,
    template_id: fields.template_id !== undefined ? (Number(fields.template_id) || null) : current.template_id,
  };
  merged.message = buildMessage(merged);
  return enrich(Promotion.update(id, merged));
}

function refreshMessages() {
  const rows = db.prepare('SELECT * FROM promotions').all();
  const update = db.prepare('UPDATE promotions SET message = ? WHERE id = ?');
  let updated = 0;
  const apply = db.transaction(() => {
    for (const promotion of rows) {
      try {
        update.run(buildMessage(promotion), promotion.id);
        updated++;
      } catch (e) {
        // Uma promoção com template inválido não deve impedir as demais.
      }
    }
  });
  apply();
  return updated;
}

function enrich(promotion) {
  const base = { ...promotion, store_label: storeLabel(promotion.store), available_coupons: Coupon.activeByPlatform(promotion.store) };
  if (promotion.store === 'mercadolivre' && promotion.price) {
    const ml = bestMlCoupon(promotion.price, promotion);
    if (ml) {
      base.price_with_coupon = ml.price_with_coupon;
      base.coupon_applied = { code: ml.code, ...ml };
    }
  }
  return base;
}

module.exports = { generateFromLinks, createFromData, updatePromotion, buildMessage, prepareForSend, refreshMessages, enrich, MAX_LINKS };
