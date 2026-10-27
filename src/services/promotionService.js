const { scrapeProduct } = require('./scraper');
const { storeLabel } = require('./scraper/storeDetector');
const templateEngine = require('./templateEngine');
const Promotion = require('../models/Promotion');
const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const Coupon = require('../models/Coupon');

const MAX_LINKS = 30;

function buildMessage(promotion) {
  const template = (promotion.template_id && Template.find(promotion.template_id)) || Template.getDefault();
  const coupon = promotion.coupon_id ? Coupon.find(promotion.coupon_id) : null;
  const slogan = promotion.slogan_id ? Slogan.find(promotion.slogan_id) : null;
  const ctx = templateEngine.buildContext({ promotion, coupon, slogan, storeLabel: storeLabel(promotion.store) });
  return templateEngine.render(template.content, ctx);
}

async function generateFromLinks({ links, templateId, storeHint = null, sloganMode = 'random' }) {
  const unique = [...new Set(links.map(l => l.trim()).filter(Boolean))].slice(0, MAX_LINKS);
  const template = (templateId && Template.find(templateId)) || Template.getDefault();

  return Promise.all(unique.map(async url => {
    try {
      const data = await scrapeProduct(url);
      if (storeHint) data.store = storeHint;
      const slogan = sloganMode === 'random' ? Slogan.random() : null;
      const autoCoupon = Coupon.activeByPlatform(data.store)[0] || null;
      const draft = { ...data, template_id: template.id, slogan_id: slogan?.id || null, coupon_id: autoCoupon?.id || null };
      draft.message = buildMessage(draft);
      return { ok: true, promotion: enrich(Promotion.create(draft)) };
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

function enrich(promotion) {
  return { ...promotion, store_label: storeLabel(promotion.store), available_coupons: Coupon.activeByPlatform(promotion.store) };
}

module.exports = { generateFromLinks, updatePromotion, buildMessage, enrich, MAX_LINKS };
