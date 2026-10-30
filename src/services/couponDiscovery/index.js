const ml = require('./mercadolivre');
const MLCoupon = require('../../models/MLCoupon');
const CouponBatch = require('../../models/CouponBatch');
const planner = require('../sendPlanner');
const { getConfig } = require('./config');
const Group = require('../../models/Group');
const Coupon = require('../../models/Coupon');
const { db } = require('../../config/database');
const logger = require('../logger');

const BATCH_SIZE = 10;

function money(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}

function truncate(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}

function couponDiscount(c) {
  const value = Number(c.discount_value);
  if (!value) return '';
  return c.discount_type === 'percent' ? `${value}% OFF` : `${money(value)} OFF`;
}

function couponLine(c) {
  const parts = [`\`${c.code}\``];
  const discount = couponDiscount(c);
  if (discount) parts.push(`*${discount}*`);
  if (c.min_purchase) parts.push(`mín. ${money(c.min_purchase)}`);
  if (c.max_discount) parts.push(`máx. ${money(c.max_discount)}`);
  return parts.join(' • ');
}

function buildCouponMessage(c) {
  const lines = ['🎟️ *CUPOM MERCADO LIVRE*', '', couponLine(c)];
  if (c.title && String(c.title).trim().toUpperCase() !== String(c.code).trim().toUpperCase()) {
    lines.push(truncate(c.title, 100));
  }
  if (c.rules_text) lines.push(`_${truncate(c.rules_text, 160)}_`);
  lines.push('', '🛍️ Use no Mercado Livre antes que acabe!');
  return lines.join('\n');
}

function buildCouponsListMessage(coupons, opts = {}) {
  const list = Array.isArray(coupons) ? coupons : [];
  const lines = [`🎟️ *CUPONS MERCADO LIVRE* (${list.length})`, ''];

  list.forEach(c => {
    lines.push(couponLine(c));
    if (opts.includeRules !== false && c.rules_text) {
      lines.push(`_${truncate(c.rules_text, 120)}_`);
    }
  });

  lines.push('', '🛍️ Use no Mercado Livre antes que acabe!');
  return lines.join('\n');
}

function enqueueCoupons(coupons, groupIds, opts = {}) {
  const all = Array.isArray(coupons) ? coupons : [];
  const candidates = all.filter(c => c && c.id);
  const list = candidates.filter(c => couponIsLive(c, new Date()));
  const groups = [...new Set((Array.isArray(groupIds) ? groupIds : []).map(Number).filter(Boolean))];
  if (!list.length || !groups.length) {
    return { batches: 0, coupons: 0, first: null, last: null };
  }
  const skipped = candidates.length - list.length;
  if (skipped) {
    logger.info('cupons_ml', 'Cupons ignorados por estarem indisponiveis', { skipped }, opts.source || 'coupon_discovery');
  }

  const includeRules = opts.includeRules !== false;
  const source = opts.source || 'coupon_discovery';
  const created = [];

  let queuedCoupons = 0;

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const chunk = list.slice(i, i + BATCH_SIZE);
    const slot = planner.nextSlot(new Date());
    if (!slot) break;

    const message = buildCouponsListMessage(chunk, { includeRules });
    const batch = CouponBatch.create({
      group_ids: groups,
      coupon_ids: chunk.map(c => c.id),
      message,
      scheduled_at: slot.toISOString(),
    });
    MLCoupon.markQueued(chunk.map(c => c.id));
    created.push({ batch, scheduledAt: slot });
    queuedCoupons += chunk.length;
    logger.info('cupons_ml', 'Lote de cupons agendado', {
      batch_id: batch.id,
      coupons: chunk.length,
      groups: groups.length,
      scheduled_at: slot.toISOString(),
    }, source);
  }

  if (created.length) planner.rebalanceQueue();

  const refreshed = created.map(({ batch }) => CouponBatch.find(batch.id)).filter(Boolean);
  const times = refreshed.map(batch => batch.scheduled_at).sort();

  if (queuedCoupons < list.length) {
    logger.info('cupons_ml', 'Fila do dia cheia; cupons restantes ficaram para depois', {
      scheduled: queuedCoupons,
      remaining: list.length - queuedCoupons,
      groups: groups.length,
    }, source);
  }

  return {
    batches: refreshed.length,
    coupons: queuedCoupons,
    first: times[0] || null,
    last: times.at(-1) || null,
  };
}

function applyCoupon(price, coupon){
  if(!price || !coupon) return { price_with_coupon: price, applied:false };
  let p = Number(price);
  if(coupon.min_purchase && p < Number(coupon.min_purchase)) return { price_with_coupon: price, applied:false, reason:'below_min' };
  let disc = 0;
  if(coupon.discount_type==='percent'){
    disc = p * (Number(coupon.discount_value)/100);
    if(coupon.max_discount && disc > Number(coupon.max_discount)) disc = Number(coupon.max_discount);
  }else{
    disc = Number(coupon.discount_value)||0;
  }
  let np = p - disc;
  if(np < 0) np = 0;
  return { price_with_coupon: Math.round(np*100)/100, discount_applied: Math.round(disc*100)/100, applied:true };
}

function couponExpiryTime(value) {
  const str = String(value ?? '').trim();
  if (!str) return null;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T23:59:59.999` : str;
  const t = new Date(until).getTime();
  return Number.isNaN(t) ? null : t;
}

function couponIsExpired(coupon, now = new Date()) {
  const until = couponExpiryTime(coupon?.valid_until ?? coupon?.valid_from);
  if (until === null) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return until < end.getTime();
}

function couponIsLive(coupon, now = new Date()) {
  if (!coupon) return false;
  const active = coupon.active === undefined ? 1 : Number(coupon.active);
  if (!active) return false;
  if (!Number(coupon.discount_value)) return false;
  if (couponIsExpired(coupon, now)) return false;
  return true;
}

/**
 * Só considera cupom válido quando está ativo, dentro da data de validade,
 * com desconto cadastrado e aplicável ao preço da promoção (mín. compra/máx. desconto).
 */
function isCouponAvailable(coupon, price, now = new Date()) {
  if (!coupon) return { available: false, reason: 'missing', applied: false };
  if (!couponIsLive(coupon, now)) {
    const active = coupon.active === undefined ? 1 : Number(coupon.active);
    const reason = !active ? 'inactive' : (!Number(coupon.discount_value) ? 'no_discount' : couponIsExpired(coupon, now) ? 'expired' : 'unavailable');
    return { available: false, reason, applied: false };
  }
  const res = applyCoupon(price, coupon);
  if (!res.applied) return { available: false, reason: res.reason || 'not_applicable', applied: false };
  return { available: true, ...res };
}

function buildExhaustedMessage(coupons) {
  const list = Array.isArray(coupons) ? coupons : [];
  const single = list.length === 1;
  const lines = [single ? '❌ *CUPOM ESGOTADO*' : `❌ *CUPONS ESGOTADOS* (${list.length})`, ''];
  list.forEach(c => lines.push(`🎟️ ~${c.code}~`));
  lines.push('', single
    ? 'Esse cupom esgotou. Fique de olho que logo tem cupom novo! 👀'
    : 'Esses cupons esgotaram. Fique de olho que logo tem cupom novo! 👀');
  return lines.join('\n');
}

/** Tira cupons esgotados dos lotes que ainda não foram enviados. */
function dropFromPendingBatches(ids, opts = {}) {
  const gone = new Set((ids || []).map(Number));
  if (!gone.size) return 0;
  let changed = 0;
  for (const batch of CouponBatch.allPending()) {
    if (!batch.coupon_ids.some(id => gone.has(Number(id)))) continue;
    const remaining = batch.coupon_ids.filter(id => !gone.has(Number(id)));
    if (!remaining.length) {
      CouponBatch.cancel(batch.id);
    } else {
      const coupons = remaining.map(id => db.prepare('SELECT * FROM ml_coupons WHERE id = ?').get(id)).filter(Boolean);
      CouponBatch.updateContent(batch.id, {
        coupon_ids: remaining,
        message: buildCouponsListMessage(coupons, { includeRules: opts.includeRules }),
      });
    }
    changed++;
  }
  return changed;
}

/**
 * Desativa os cupons que as fontes marcam como esgotados. Os que ainda não
 * foram divulgados só saem da fila; os já divulgados ganham aviso nos grupos.
 */
function markExhausted(expired, cfg) {
  const ids = [];
  for (const item of expired || []) {
    const coupon = MLCoupon.findActiveMatching(item);
    if (!coupon) continue;
    MLCoupon.markExhausted(coupon.id);
    try { db.prepare('UPDATE coupons SET active = 0 WHERE UPPER(code) = UPPER(?)').run(coupon.code); } catch (e) {}
    ids.push(coupon.id);
    logger.info('cupons_ml', 'Cupom esgotado', { code: coupon.code, published: Boolean(coupon.last_published_at) }, 'coupon_discovery');
  }
  if (ids.length) dropFromPendingBatches(ids, { includeRules: cfg.include_rules !== false });
  return ids.length;
}

async function notifyExhausted(groupIds) {
  const pending = MLCoupon.pendingExhaustNotices();
  if (!pending.length || !groupIds.length) return 0;
  // Fora da janela de envio o aviso espera a próxima busca dentro dela.
  if (!planner.isWithinWindow(new Date())) return 0;

  const message = buildExhaustedMessage(pending);
  const dispatcher = require('../messaging/dispatcher');
  const report = await dispatcher.sendMessageToGroups(message, groupIds, {
    category: 'cupons_ml',
    source: 'coupon_discovery',
  });
  const delivered = report.some(r => r.ok);
  if (delivered) MLCoupon.markExhaustNotified(pending.map(c => c.id));
  MLCoupon.logPublish({
    ml_coupon_id: null,
    group_ids: groupIds,
    message,
    status: delivered ? 'sent' : 'failed',
    report_json: JSON.stringify(report),
  });
  logger.info('cupons_ml', 'Aviso de cupom esgotado enviado', {
    coupons: pending.map(c => c.code),
    delivered,
  }, 'coupon_discovery');
  return delivered ? pending.length : 0;
}

/** Checagem periódica: só desativa/avisa esgotados, sem publicar cupons novos. */
async function checkExhausted() {
  const cfg = getConfig();
  if (cfg.enabled === false || cfg.enabled === 'false') return { skipped: true };
  const { expired } = await require('./mercadolivre').discover();
  const groupIds = Array.isArray(cfg.group_ids) ? cfg.group_ids.filter(Boolean).map(Number) : [];
  const exhausted = markExhausted(expired, cfg);
  const exhaustedNotified = await notifyExhausted(groupIds);
  return { exhausted, exhaustedNotified };
}

function cleanupCoupons() {
  const removed = MLCoupon.removeOlderThanToday();
  if (removed) {
    logger.info('cupons_ml', 'Cupons de dias anteriores removidos', { removed }, 'coupon_discovery');
  }
  return removed;
}

async function runOnce(){
  try {
    const cfg = getConfig();
    if(cfg.enabled==='false') return {skipped:true};
    // Mantém somente os cupons do dia para que a busca encontre novidades.
    try { cleanupCoupons(); } catch(e) {
      logger.warn('cupons_ml', 'Falha ao limpar cupons antigos', logger.errorMeta(e), 'coupon_discovery');
    }
    const { coupons: list, expired } = await require('./mercadolivre').discover();
    let saved=0;
    for(const c of list){
      try{
        MLCoupon.upsert(c);
        saved++;
      }catch(e){
        logger.warn('cupons_ml', 'Falha ao salvar cupom', logger.errorMeta(e, { code: c.code }), 'coupon_discovery');
      }
    }
    const groupIds = Array.isArray(cfg.group_ids)?cfg.group_ids.filter(Boolean).map(Number):[];

    let exhausted = 0, exhaustedNotified = 0;
    try {
      exhausted = markExhausted(expired, cfg);
      exhaustedNotified = await notifyExhausted(groupIds);
    } catch (e) {
      logger.error('cupons_ml', 'Falha ao tratar cupons esgotados', logger.errorMeta(e), 'coupon_discovery');
    }
    const autoPublish = !(cfg.auto_publish === false || cfg.auto_publish === 'false');
    if (autoPublish) {
      try { db.prepare('UPDATE ml_coupons SET auto_publish = 1 WHERE last_published_at IS NULL').run(); }
      catch(e){ logger.warn('cupons_ml', 'Falha ao marcar cupons novos para publicação', logger.errorMeta(e), 'coupon_discovery'); }
    }
    const newCoupons = MLCoupon.pendingAuto();
    let batchesScheduled = 0, couponsQueued = 0;

    if (autoPublish && groupIds.length && newCoupons.length) {
      try {
        const queued = enqueueCoupons(newCoupons, groupIds, {
          includeRules: cfg.include_rules !== false,
          source: 'coupon_discovery',
        });
        batchesScheduled = queued.batches;
        couponsQueued = queued.coupons;
      } catch (e) {
        logger.error('cupons_ml', 'Falha ao agendar lotes de cupons', logger.errorMeta(e, { group_ids: groupIds, coupons: newCoupons.length }), 'coupon_discovery');
      }
    }

    return {
      found: list.length,
      saved,
      published: 0,
      couponsListed: 0,
      batchesScheduled,
      couponsQueued,
      exhausted,
      exhaustedNotified,
      groupIds: groupIds.length,
    };
  } catch(e){
    logger.error('cupons_ml', 'Falha na busca de cupons', logger.errorMeta(e), 'coupon_discovery');
    return {error:e.message};
  }
}

function syncToCoupons(){
  try {
    const mlList = MLCoupon.active();
    for(const c of mlList){
      try{
        const exists = db.prepare("SELECT id FROM coupons WHERE UPPER(code)=UPPER(?)").get(c.code);
        if(exists) continue;
        db.prepare(`INSERT INTO coupons (code, platform, discount_type, discount_value, description, min_purchase, max_discount, rules_text, source, valid_until)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(c.code, 'mercadolivre', c.discount_type||'percent', c.discount_value||0, c.title||c.code, c.min_purchase||null, c.max_discount||null, c.rules_text||null, 'ml', c.valid_until||null);
      }catch(e){
        logger.warn('cupons', 'Falha ao sincronizar cupom do Mercado Livre', logger.errorMeta(e, { code: c.code }), 'coupon_discovery');
      }
    }
  } catch(e){
    logger.error('cupons', 'Falha ao sincronizar cupons do Mercado Livre', logger.errorMeta(e), 'coupon_discovery');
  }
}

module.exports = { runOnce, checkExhausted, cleanupCoupons, enqueueCoupons, buildCouponMessage, buildCouponsListMessage, buildExhaustedMessage, applyCoupon, isCouponAvailable, couponIsExpired, syncToCoupons, BATCH_SIZE };
