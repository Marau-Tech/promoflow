const Schedule = require('../models/Schedule');
const CouponBatch = require('../models/CouponBatch');
const MLCoupon = require('../models/MLCoupon');
const Promotion = require('../models/Promotion');
const dispatcher = require('./messaging/dispatcher');
const planner = require('./sendPlanner');
const logger = require('./logger');

const INTERVAL_MS = 30000;
let running = false;

async function tick() {
  if (running) return;          // evita sobreposição se um envio demorar
  running = true;
  try {
    try {
      planner.trimOutsideToday();
    } catch (err) {
      logger.error('agendamentos', 'Falha ao limitar a fila automática ao dia atual', logger.errorMeta(err), 'scheduler');
    }

    if (!planner.isWithinWindow(new Date())) return;

    const { intervalMs, start, end } = planner.settings();
    const last = planner.lastSendTime();
    if (last && Date.now() - last < intervalMs) return;

    // envia no máximo um por verificação para manter o ritmo entre envios.
    // Produtos e lotes de cupons disputam a mesma fila e são intercalados pelo horário.
    const nextProduct = Schedule.due()[0];
    const nextCoupon = CouponBatch.due()[0];
    if (!nextProduct && !nextCoupon) return;

    if (nextCoupon && nextCouponIsNext(nextProduct, nextCoupon)) {
      await sendCouponBatch(nextCoupon);
      return;
    }

    const next = nextProduct;
    const promotion = Promotion.find(next.promotion_id);
    if (!promotion) {
      logger.error('agendamentos', 'Agendamento sem promoção válida', {
        schedule_id: next.id,
        promotion_id: next.promotion_id,
      }, 'scheduler');
      Schedule.markFailed(next.id, 'Promoção não existe mais');
      return;
    }

    try {
      console.log(`[Agendamento] Enviando #${next.id} para ${next.group_ids.length} grupo(s) (janela ${start}h-${end}h)`);
      logger.info('agendamentos', 'Envio agendado iniciado', {
        schedule_id: next.id,
        promotion_id: promotion.id,
        title: promotion.title,
        group_ids: next.group_ids,
      }, 'scheduler');

      const report = await dispatcher.sendToGroups(promotion, next.group_ids, {
        category: 'agendamentos',
        source: 'scheduler',
      });
      Schedule.markSent(next.id, report);

      const failed = report.filter(r => !r.ok).length;
      if (failed) {
        logger.warn('agendamentos', `Envio concluído com ${failed} falha(s)`, {
          schedule_id: next.id,
          promotion_id: promotion.id,
          report,
        }, 'scheduler');
      } else {
        logger.info('agendamentos', 'Envio agendado concluído', {
          schedule_id: next.id,
          promotion_id: promotion.id,
          groups: report.length,
        }, 'scheduler');
      }
    } catch (err) {
      Schedule.markFailed(next.id, err.message);
      logger.error('agendamentos', 'Falha inesperada no envio agendado', logger.errorMeta(err, {
        schedule_id: next.id,
        promotion_id: next.promotion_id,
      }), 'scheduler');
    }
  } finally {
    running = false;
  }
}

function nextCouponIsNext(product, coupon) {
  if (!product) return true;
  if (!coupon) return false;
  const productAt = new Date(product.scheduled_at).getTime();
  const couponAt = new Date(coupon.scheduled_at).getTime();
  if (couponAt !== productAt) return couponAt < productAt;
  const lastProduct = Number(Schedule.lastSentEpoch()) || 0;
  const lastCoupon = Number(CouponBatch.lastSentEpoch()) || 0;
  return lastCoupon <= lastProduct;
}

async function sendCouponBatch(batch) {
  try {
    console.log(`[Agendamento] Enviando lote de cupons #${batch.id} (${batch.coupon_ids.length} cupons) para ${batch.group_ids.length} grupo(s)`);
    logger.info('cupons_ml', 'Envio de lote de cupons iniciado', {
      batch_id: batch.id,
      coupons: batch.coupon_ids.length,
      group_ids: batch.group_ids,
    }, 'scheduler');

    const report = await dispatcher.sendMessageToGroups(batch.message, batch.group_ids, {
      category: 'cupons_ml',
      source: 'scheduler',
    });
    const status = CouponBatch.markSent(batch.id, report);

    if (status === 'sent') {
      for (const id of batch.coupon_ids) MLCoupon.markPublished(id);
    } else {
      MLCoupon.releaseQueued(batch.coupon_ids);
    }

    try {
      MLCoupon.logPublish({
        ml_coupon_id: null,
        group_ids: batch.group_ids,
        message: batch.message,
        status,
        report_json: JSON.stringify(report),
      });
    } catch (e) {
      logger.warn('cupons_ml', 'Falha ao registrar envio do lote de cupons', logger.errorMeta(e, { batch_id: batch.id }), 'scheduler');
    }

    const failed = report.filter(r => !r.ok).length;
    if (status === 'failed') {
      logger.warn('cupons_ml', 'Lote de cupons não entregue', {
        batch_id: batch.id,
        coupons: batch.coupon_ids.length,
        report,
      }, 'scheduler');
    } else if (failed) {
      logger.warn('cupons_ml', `Lote de cupons concluído com ${failed} falha(s)`, {
        batch_id: batch.id,
        coupons: batch.coupon_ids.length,
        report,
      }, 'scheduler');
    } else {
      logger.info('cupons_ml', 'Lote de cupons enviado', {
        batch_id: batch.id,
        coupons: batch.coupon_ids.length,
        groups: report.length,
      }, 'scheduler');
    }
  } catch (err) {
    CouponBatch.markFailed(batch.id, err.message);
    MLCoupon.releaseQueued(batch.coupon_ids);
    logger.error('cupons_ml', 'Falha inesperada no envio do lote de cupons', logger.errorMeta(err, {
      batch_id: batch.id,
      coupons: batch.coupon_ids.length,
    }), 'scheduler');
  }
}

function start() {
  tick().catch(err => logger.error('agendamentos', 'Erro no loop do agendador', logger.errorMeta(err), 'scheduler'));
  setInterval(() => tick().catch(err => logger.error('agendamentos', 'Erro no loop do agendador', logger.errorMeta(err), 'scheduler')), INTERVAL_MS);
  logger.info('agendamentos', 'Agendador iniciado', { interval_seconds: INTERVAL_MS / 1000 }, 'scheduler');
  console.log('[Agendamento] Verificando envios a cada 30s');
}

module.exports = { start, tick };
