const Schedule = require('../models/Schedule');
const CouponBatch = require('../models/CouponBatch');
const MLCoupon = require('../models/MLCoupon');
const Promotion = require('../models/Promotion');
const Group = require('../models/Group');
const logger = require('../services/logger');

const MAX_DAYS = 10;

exports.index = (req, res) => {
  const status = ['pending', 'sent', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const groups = Object.fromEntries(Group.all().map(g => [g.id, g]));
  const couponCodes = Object.fromEntries(MLCoupon.all().map(c => [c.id, c.code]));
  const scheduleCounts = Schedule.counts();
  const couponCounts = CouponBatch.counts();
  const counts = {};
  for (const key of new Set([...Object.keys(scheduleCounts), ...Object.keys(couponCounts)])) {
    counts[key] = (scheduleCounts[key] || 0) + (couponCounts[key] || 0);
  }

  res.render('schedules/index', {
    title: 'Agendamentos',
    schedules: Schedule.all(status).map(s => ({ ...s, groups: s.group_ids.map(id => groups[id]).filter(Boolean) })),
    couponBatches: CouponBatch.all(status).map(b => ({
      ...b,
      groups: b.group_ids.map(id => groups[id]).filter(Boolean),
      codes: b.coupon_ids.map(id => couponCodes[id]).filter(Boolean),
    })),
    status,
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  });
};

/** POST /api/schedules { promotionId, groupIds, scheduledAt (ISO) } */
exports.create = (req, res, next) => {
  try {
    const { promotionId, groupIds = [], scheduledAt } = req.body;
    const promotion = Promotion.find(Number(promotionId));
    if (!promotion) return res.status(404).json({ error: 'Promoção não encontrada' });
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Data/hora inválida.' });
    if (when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'A data precisa ser no futuro.' });
    if (when.getTime() > Date.now() + MAX_DAYS * 86400000) return res.status(400).json({ error: `Máximo de ${MAX_DAYS} dias a partir de hoje.` });

    const schedule = Schedule.create({ promotion_id: promotion.id, group_ids: groupIds.map(Number), scheduled_at: when.toISOString() });
    logger.info('agendamentos', 'Agendamento criado', { schedule_id: schedule.id, promotion_id: promotion.id, scheduled_at: when.toISOString() }, 'schedules');
    res.json({ schedule });
  } catch (err) { next(err); }
};

/** POST /api/schedules/batch { promotionIds:[], groupIds:[], startAt (ISO), intervalMinutes } */
exports.createBatch = (req, res, next) => {
  try {
    const { promotionIds = [], groupIds = [], startAt, intervalMinutes = 15 } = req.body;
    if (!promotionIds.length) return res.status(400).json({ error: 'Nenhuma promoção para agendar.' });
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });

    const interval = Math.max(1, Number(intervalMinutes) || 15);
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Data/hora de início inválida.' });
    if (start.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'O início precisa ser agora ou no futuro.' });

    const last = start.getTime() + (promotionIds.length - 1) * interval * 60000;
    if (last > Date.now() + MAX_DAYS * 86400000) {
      return res.status(400).json({ error: `Com esse intervalo o último envio passa do limite de ${MAX_DAYS} dias.` });
    }

    const created = [];
    promotionIds.forEach((pid, i) => {
      const promotion = Promotion.find(Number(pid));
      if (!promotion) return;
      const when = new Date(start.getTime() + i * interval * 60000).toISOString();
      created.push(Schedule.create({ promotion_id: promotion.id, group_ids: groupIds.map(Number), scheduled_at: when }));
    });

    logger.info('agendamentos', 'Agendamentos em lote criados', {
      created: created.length,
      first: created[0]?.scheduled_at,
      last: created.at(-1)?.scheduled_at,
      interval_minutes: interval,
    }, 'schedules');
    res.json({ created: created.length, first: created[0]?.scheduled_at, last: created.at(-1)?.scheduled_at });
  } catch (err) { next(err); }
};

exports.cancel = (req, res) => {
  Schedule.cancel(Number(req.params.id));
  logger.info('agendamentos', 'Agendamento cancelado', { schedule_id: req.params.id }, 'schedules');
  res.redirect('/agendamentos');
};
exports.remove = (req, res) => {
  Schedule.remove(Number(req.params.id));
  logger.info('agendamentos', 'Agendamento removido do histórico', { schedule_id: req.params.id }, 'schedules');
  res.redirect('/agendamentos');
};

exports.cancelAll = (req, res) => {
  const pendingBatches = CouponBatch.allPending();
  const couponIds = pendingBatches.flatMap(b => b.coupon_ids);

  const schedules = Schedule.cancelAll();
  const batches = CouponBatch.cancelAll();
  if (couponIds.length) MLCoupon.releaseQueued(couponIds);

  logger.info('agendamentos', 'Todos os agendamentos pendentes cancelados', {
    schedules,
    coupon_batches: batches,
    coupons_released: couponIds.length,
  }, 'schedules');
  res.redirect('/agendamentos');
};

exports.removeAll = (req, res) => {
  const pendingBatches = CouponBatch.allPending();
  const couponIds = pendingBatches.flatMap(b => b.coupon_ids);

  const schedules = Schedule.removeAll();
  const batches = CouponBatch.removeAll();
  if (couponIds.length) MLCoupon.releaseQueued(couponIds);

  logger.info('agendamentos', 'Todos os registros de agendamento foram excluídos', {
    schedules,
    coupon_batches: batches,
    coupons_released: couponIds.length,
  }, 'schedules');
  res.redirect('/agendamentos');
};

exports.cancelCouponBatch = (req, res) => {
  const batch = CouponBatch.find(Number(req.params.id));
  if (batch && batch.status === 'pending') {
    CouponBatch.cancel(batch.id);
    MLCoupon.releaseQueued(batch.coupon_ids);
    logger.info('cupons_ml', 'Lote de cupons cancelado', { batch_id: batch.id, coupons: batch.coupon_ids.length }, 'schedules');
  }
  res.redirect('/agendamentos');
};

exports.removeCouponBatch = (req, res) => {
  const batch = CouponBatch.find(Number(req.params.id));
  if (batch) {
    if (batch.status === 'pending') MLCoupon.releaseQueued(batch.coupon_ids);
    CouponBatch.remove(batch.id);
    logger.info('cupons_ml', 'Lote de cupons removido do histórico', { batch_id: batch.id }, 'schedules');
  }
  res.redirect('/agendamentos');
};
