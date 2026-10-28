const { db } = require('../config/database');
const Schedule = require('../models/Schedule');
const CouponBatch = require('../models/CouponBatch');
const MLCoupon = require('../models/MLCoupon');
const { getConfig } = require('./autoDiscovery/config');
const logger = require('./logger');

function settings() {
  const cfg = getConfig();
  const interval = Math.min(240, Math.max(1, Number(cfg.send_interval_minutes) || 15));
  const start = Math.min(23, Math.max(0, Number(cfg.send_start_hour ?? 8)));
  const end = Math.min(24, Math.max(start + 1, Number(cfg.send_end_hour ?? 21)));
  return { interval, start, end, intervalMs: interval * 60000 };
}

function atHour(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function isWithinWindow(date = new Date()) {
  const { start, end } = settings();
  const h = date.getHours();
  return h >= start && h < end;
}

function dayBounds(date = new Date(), s = settings()) {
  return {
    start: atHour(date, s.start),
    end: atHour(date, s.end),
  };
}

/**
 * Arredonda para o próximo slot da janela. Retorna null quando o dia acabou,
 * para que nada seja agendado automaticamente para o dia seguinte.
 */
function alignSlot(base, s = settings()) {
  const { start, end } = dayBounds(base, s);
  let slot = new Date(base);
  slot.setSeconds(0, 0);
  const rem = slot.getMinutes() % s.interval;
  if (rem !== 0) slot.setMinutes(slot.getMinutes() + (s.interval - rem));
  if (slot.getTime() < base) slot = new Date(slot.getTime() + s.intervalMs);
  if (slot.getTime() < start.getTime()) slot = new Date(start.getTime());
  if (slot.getTime() >= end.getTime()) return null;
  return slot;
}

function lastSendTime() {
  return Math.max(Number(Schedule.lastSentEpoch()) || 0, Number(CouponBatch.lastSentEpoch()) || 0);
}

function nextSlot(after = new Date()) {
  const s = settings();
  const { end } = dayBounds(after, s);
  let base = after.getTime();

  const pending = [Schedule.lastPendingAt(), CouponBatch.lastPendingAt()]
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(t => Number.isFinite(t) && t < end.getTime());
  if (pending.length) base = Math.max(base, Math.max(...pending) + s.intervalMs);

  const last = lastSendTime();
  if (last) base = Math.max(base, last + s.intervalMs);

  return alignSlot(new Date(base), s);
}

/**
 * Distribui os lotes de cupons ao longo da fila de produtos, preservando a
 * ordem interna de cada tipo. A quantidade menor é espaçada proporcionalmente.
 */
function interleaveQueues(products, coupons, startType) {
  const total = products.length + coupons.length;
  if (!total) return [];

  const targets = coupons.map((_, index) => {
    const offset = startType === 'coupon' ? 0 : 0.5;
    return (index + offset) * total / coupons.length;
  });

  const sequence = [];
  let productIndex = 0;
  let couponIndex = 0;

  for (let position = 0; position < total; position++) {
    const takeCoupon = couponIndex < coupons.length
      && (productIndex >= products.length || position >= targets[couponIndex]);

    if (takeCoupon) {
      sequence.push({ type: 'coupon', item: coupons[couponIndex++] });
    } else {
      sequence.push({ type: 'product', item: products[productIndex++] });
    }
  }

  return sequence;
}

function cancelQueueSteps(steps) {
  let schedules = 0;
  let couponBatches = 0;
  let couponsReleased = 0;

  for (const step of steps) {
    if (step.type === 'product') {
      Schedule.cancel(step.item.id);
      schedules++;
    } else if (CouponBatch.cancel(step.item.id)) {
      MLCoupon.releaseQueued(step.item.coupon_ids);
      couponsReleased += step.item.coupon_ids.length;
      couponBatches++;
    }
  }

  return { schedules, couponBatches, couponsReleased };
}

/**
 * Reordena a fila automática para alternar produtos e lotes de cupons.
 * Itens que já estão vencidos (ou vencendo no próximo minuto) não são movidos.
 * Nada é empurrado para o dia seguinte: o excedente é cancelado.
 */
function rebalanceQueue(now = new Date()) {
  const products = Schedule.pendingAuto();
  const coupons = CouponBatch.allPending();
  if (!products.length || !coupons.length) return 0;

  const cutoff = now.getTime() + 60000;
  const movableProducts = products
    .filter(item => new Date(item.scheduled_at).getTime() > cutoff)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const movableCoupons = coupons
    .filter(item => new Date(item.scheduled_at).getTime() > cutoff)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  if (!movableProducts.length || !movableCoupons.length) return 0;

  const firstProduct = new Date(movableProducts[0].scheduled_at).getTime();
  const firstCoupon = new Date(movableCoupons[0].scheduled_at).getTime();
  let startType;
  if (firstProduct !== firstCoupon) {
    startType = firstProduct < firstCoupon ? 'product' : 'coupon';
  } else {
    const lastProduct = Number(Schedule.lastSentEpoch()) || 0;
    const lastCoupon = Number(CouponBatch.lastSentEpoch()) || 0;
    startType = lastCoupon <= lastProduct ? 'coupon' : 'product';
  }

  const sequence = interleaveQueues(movableProducts, movableCoupons, startType);
  const s = settings();
  const { end } = dayBounds(now, s);
  const earliest = new Date(sequence[0].item.scheduled_at).getTime();
  const last = lastSendTime();
  const base = Math.max(now.getTime(), earliest, last ? last + s.intervalMs : 0);

  let cursor = alignSlot(new Date(base), s);
  const updates = [];
  const overflow = [];

  for (const step of sequence) {
    if (!cursor || cursor.getTime() >= end.getTime()) {
      overflow.push(step);
      continue;
    }

    updates.push({ type: step.type, id: step.item.id, scheduled_at: cursor.toISOString() });
    const next = new Date(cursor.getTime() + s.intervalMs);
    cursor = next.getTime() >= end.getTime() ? null : next;
  }

  const apply = db.transaction(() => {
    for (const update of updates) {
      if (update.type === 'product') Schedule.reschedule(update.id, update.scheduled_at);
      else CouponBatch.reschedule(update.id, update.scheduled_at);
    }
    return cancelQueueSteps(overflow);
  });
  const cancelled = apply();

  if (cancelled.schedules || cancelled.couponBatches) {
    logger.warn('agendamentos', 'Excedente da fila diária cancelado', {
      schedules: cancelled.schedules,
      coupon_batches: cancelled.couponBatches,
      coupons_released: cancelled.couponsReleased,
    }, 'send_planner');
  }

  return updates.length;
}

/**
 * Remove da fila automática tudo que não pertence à janela de envio de hoje.
 * Promoções agendadas manualmente não são afetadas.
 */
function trimOutsideToday(now = new Date()) {
  const s = settings();
  const { start, end } = dayBounds(now, s);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const schedules = db.prepare(`
    SELECT id FROM schedules
    WHERE status = 'pending' AND source = 'auto'
      AND (scheduled_at < ? OR scheduled_at >= ?)
  `).all(startIso, endIso);

  const batches = db.prepare(`
    SELECT id, coupon_ids FROM coupon_batches
    WHERE status = 'pending'
      AND (scheduled_at < ? OR scheduled_at >= ?)
  `).all(startIso, endIso);

  if (!schedules.length && !batches.length) {
    return { schedules: 0, couponBatches: 0, couponsReleased: 0 };
  }

  const apply = db.transaction(() => {
    for (const schedule of schedules) Schedule.cancel(schedule.id);

    let couponsReleased = 0;
    for (const batch of batches) {
      if (!CouponBatch.cancel(batch.id)) continue;
      let ids = [];
      try { ids = JSON.parse(batch.coupon_ids || '[]'); } catch (e) { ids = []; }
      MLCoupon.releaseQueued(ids);
      couponsReleased += ids.length;
    }

    return {
      schedules: schedules.length,
      couponBatches: batches.length,
      couponsReleased,
    };
  });
  const result = apply();

  logger.info('agendamentos', 'Fila automática limitada ao dia atual', result, 'send_planner');
  return result;
}

function enqueuePromotion(promotionId, groupIds, source = 'auto') {
  const slot = nextSlot(new Date());
  if (!slot) return { schedule: null, scheduledAt: null, full: true };

  const schedule = Schedule.create({
    promotion_id: promotionId,
    group_ids: groupIds.map(Number),
    scheduled_at: slot.toISOString(),
    source,
  });
  rebalanceQueue();
  const fresh = Schedule.find(schedule.id);
  return { schedule: fresh, scheduledAt: new Date(fresh.scheduled_at), full: false };
}

function enqueuePromotions(promotionIds, groupIds, options = {}) {
  const source = options.source || 'auto';
  const ids = [...new Set((promotionIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];

  const created = [];
  for (const promotionId of ids) {
    const slot = nextSlot(new Date());
    if (!slot) break;
    const schedule = Schedule.create({
      promotion_id: promotionId,
      group_ids: groupIds.map(Number),
      scheduled_at: slot.toISOString(),
      source,
    });
    created.push({ promotionId, schedule });
  }

  if (!created.length) return [];
  rebalanceQueue();

  return created.map(({ promotionId, schedule }) => {
    const fresh = Schedule.find(schedule.id);
    return {
      promotion_id: promotionId,
      schedule: fresh,
      scheduledAt: new Date(fresh.scheduled_at),
    };
  }).filter(item => item.schedule && item.schedule.status === 'pending');
}

module.exports = {
  settings,
  isWithinWindow,
  lastSendTime,
  nextSlot,
  dayBounds,
  rebalanceQueue,
  trimOutsideToday,
  interleaveQueues,
  enqueuePromotion,
  enqueuePromotions,
};
