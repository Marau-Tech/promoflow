const Schedule = require('../models/Schedule');
const CouponBatch = require('../models/CouponBatch');
const Promotion = require('../models/Promotion');
const MLCoupon = require('../models/MLCoupon');
const Group = require('../models/Group');
const AutoDiscoveryRun = require('../models/AutoDiscoveryRun');
const SystemLog = require('../models/SystemLog');
const planner = require('../services/sendPlanner');

function mergeCounts(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map || {})) {
      out[key] = (out[key] || 0) + Number(value || 0);
    }
  }
  return out;
}

exports.index = (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayEpoch = startOfDay.getTime();

  const scheduleCounts = Schedule.counts();
  const couponCounts = CouponBatch.counts();
  const queueCounts = mergeCounts(scheduleCounts, couponCounts);

  const productDay = Schedule.countsSince(dayEpoch);
  const couponDay = CouponBatch.countsSince(dayEpoch);
  const sentToday = Number(productDay.sent || 0) + Number(couponDay.sent || 0);
  const failedToday = Number(productDay.failed || 0) + Number(couponDay.failed || 0);

  const mlCoupons = MLCoupon.all();
  const activeCoupons = mlCoupons.filter(c => c.active).length;
  const queuedCoupons = mlCoupons.filter(c => c.queued_at).length;

  const couponCodes = Object.fromEntries(mlCoupons.map(c => [c.id, c.code]));
  const pendingProducts = Schedule.all('pending');
  const pendingCoupons = CouponBatch.all('pending', 500);

  const queue = [
    ...pendingProducts.map(item => ({
      type: 'product',
      id: item.id,
      title: item.title || `Promoção #${item.promotion_id}`,
      detail: item.store || 'produto',
      scheduled_at: item.scheduled_at,
      groups: item.group_ids.length,
    })),
    ...pendingCoupons.map(batch => {
      const codes = batch.coupon_ids.map(id => couponCodes[id]).filter(Boolean);
      const preview = codes.slice(0, 3).join(', ');
      return {
        type: 'coupon',
        id: batch.id,
        title: `Lote #${batch.id}${preview ? ` • ${preview}` : ''}${codes.length > 3 ? ` +${codes.length - 3}` : ''}`,
        detail: `${batch.coupon_ids.length} cupom(ns)`,
        scheduled_at: batch.scheduled_at,
        groups: batch.group_ids.length,
      };
    }),
  ].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const settings = planner.settings();
  const logs = SystemLog.all({ limit: 8 });
  const recentErrors = SystemLog.all({ level: 'error', limit: 5 });

  res.render('dashboard/index', {
    title: 'Início',
    queueCounts,
    pendingProducts: Number(scheduleCounts.pending || 0),
    pendingCoupons: Number(couponCounts.pending || 0),
    pendingTotal: Number(queueCounts.pending || 0),
    nextSend: queue[0] || null,
    queuePreview: queue.slice(0, 8),
    sentToday,
    failedToday,
    productSentToday: Number(productDay.sent || 0),
    couponSentToday: Number(couponDay.sent || 0),
    promotionsTotal: Promotion.count(),
    activeCoupons,
    queuedCoupons,
    activeGroups: Group.active().length,
    lastRun: AutoDiscoveryRun.recent(1)[0] || null,
    logStats: SystemLog.stats(),
    logs,
    recentErrors,
    sendStart: settings.start,
    sendEnd: settings.end,
    sendInterval: settings.interval,
  });
};
