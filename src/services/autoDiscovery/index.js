const AutoDiscoveryRun = require('../../models/AutoDiscoveryRun');
const AutoDiscoveryCandidate = require('../../models/AutoDiscoveryCandidate');
const { getConfig } = require('./config');
const ml = require('./mercadolivre');
const promotionService = require('../promotionService');
const sendPlanner = require('../sendPlanner');
const logger = require('../logger');

function calcDiscount(price, original) {
  if (!price || !original || original <= price) return null;
  return Math.round(((original - price) / original) * 100);
}

function hasExtraGain(text = '') {
  const t = String(text).toLowerCase();
  return /ganho extra|ganhos extras|comissão extra|bônus|cashback extra|extra/.test(t);
}

function scoreCandidate(c, cfg) {
  let score = 0;
  if (c.is_most_sold && cfg.prefer_most_sold !== false) score += 40;
  if (c.has_extra_gain && cfg.prefer_extra_gain !== false) score += 50;
  if (c.discount_percent >= 50) score += 20;
  else if (c.discount_percent >= 30) score += 15;
  else if (c.discount_percent >= 15) score += 10;
  if (c.price && c.price >= 30 && c.price <= 299) score += 10;
  if (c.price && c.price < 30) score += 5;
  return score;
}

function cleanupCandidates() {
  const removed = AutoDiscoveryCandidate.removeOlderThanToday();
  if (removed) {
    logger.info('mercadolivre', 'Candidatos de dias anteriores removidos', { removed }, 'auto_discovery');
  }
  return removed;
}

async function runOnce(opts = {}) {
  const cfg = getConfig();
  if (cfg.enabled === false || cfg.enabled === 'false') return { skipped: true };

  // Zera os candidatos de dias anteriores para que a busca encontre ofertas novas.
  try {
    cleanupCandidates();
  } catch (e) {
    logger.warn('mercadolivre', 'Falha ao limpar candidatos antigos', logger.errorMeta(e), 'auto_discovery');
  }

  const run = AutoDiscoveryRun.create({ ...cfg, ...opts });
  const errors = [];
  let found = 0, filtered = 0, generated = 0, sent = 0, scheduled = 0;

  logger.info('mercadolivre', 'Descoberta iniciada', {
    run_id: run.id,
    triggered_by: opts.triggered_by || 'scheduler',
    max_per_run: cfg.max_per_run,
    interval_minutes: cfg.interval_minutes,
  }, 'auto_discovery');

  try {
    const discovered = await ml.discover({
      runId: run.id,
      isKnown: (sku) => AutoDiscoveryCandidate.alreadyExists({ sku, store: 'mercadolivre' }),
    });
    found = discovered.length;

    for (const item of discovered) {
      try {
        const d = item;
        if (!d?.url && !d?.final_url) continue;
        // API preenche store; scraping já devolve mercadolivre
        d.store = d.store || 'mercadolivre';

        if (cfg.only_new !== false && AutoDiscoveryCandidate.alreadyExists({ sku: d.sku, url: d.url, store: 'mercadolivre' })) {
          continue;
        }

        const discount_percent = calcDiscount(d.price, d.original_price);
        const extraGainText = hasExtraGain(d.title) || hasExtraGain(d.final_url) ? 'Detectado' : null;
        const is_most_sold = true;

        if (cfg.require_extra_gain === true || cfg.require_extra_gain === 'true') {
          if (!hasExtraGain(d.title)) continue;
        }
        if (cfg.require_most_sold === true || cfg.require_most_sold === 'true') {
          // sempre true vindo de mais vendidos
        }
        if (cfg.min_discount && cfg.min_discount !== '' && Number(cfg.min_discount) > 0 && discount_percent !== null && discount_percent < Number(cfg.min_discount)) continue;
        if (cfg.min_price && cfg.min_price !== '' && d.price && d.price < Number(cfg.min_price)) continue;
        if (cfg.max_price && cfg.max_price !== '' && Number(cfg.max_price) > 0 && d.price && d.price > Number(cfg.max_price)) continue;

        const extraGain = hasExtraGain(d.title) ? 1 : 0;
        const score = scoreCandidate({
          is_most_sold: 1,
          has_extra_gain: extraGain,
          discount_percent,
          price: d.price,
        }, cfg);

        AutoDiscoveryCandidate.upsert({
          run_id: run.id,
          store: 'mercadolivre',
          url: d.url,
          final_url: d.final_url || d.url,
          sku: d.sku,
          title: d.title,
          price: d.price,
          original_price: d.original_price,
          discount_percent,
          image_url: d.image_url,
          is_most_sold: 1,
          has_extra_gain: extraGain,
          extra_gain_text: extraGainText,
          score,
        });
        filtered++;
      } catch (e) {
        errors.push(e.message);
        logger.warn('mercadolivre', 'Erro ao processar produto descoberto', logger.errorMeta(e, {
          run_id: run.id,
          sku: item?.sku,
          url: item?.url,
        }), 'auto_discovery');
      }
    }

    const maxPerRun = Number(cfg.max_per_run) || 20;
    const candidates = AutoDiscoveryCandidate.getNew(maxPerRun);
    const groupIds = Array.isArray(cfg.group_ids) ? cfg.group_ids.filter(Boolean).map(Number) : [];
    const autoPromotionIds = [];

    for (const c of candidates) {
      try {
        const promotion = promotionService.createFromData({
          url: c.url,
          final_url: c.final_url || c.url,
          store: 'mercadolivre',
          sku: c.sku,
          title: c.title,
          price: c.price,
          original_price: c.original_price,
          currency: 'BRL',
          image_url: c.image_url,
        });
        AutoDiscoveryCandidate.markGenerated([c.id], promotion.id);
        generated++;

        if (cfg.auto_send !== false && groupIds.length) {
          autoPromotionIds.push(promotion.id);
        }
      } catch (e) {
        errors.push(e.message);
        AutoDiscoveryCandidate.markSkipped([c.id], e.message);
        logger.warn('promocoes', 'Falha ao gerar promoção a partir da descoberta', logger.errorMeta(e, {
          run_id: run.id,
          candidate_id: c.id,
          sku: c.sku,
        }), 'auto_discovery');
      }
    }

    if (autoPromotionIds.length) {
      try {
        scheduled = sendPlanner.enqueuePromotions(autoPromotionIds, groupIds).length;
      } catch (e) {
        errors.push(e.message);
        logger.error('agendamentos', 'Falha ao agendar promoções descobertas', logger.errorMeta(e, {
          run_id: run.id,
          promotion_ids: autoPromotionIds,
        }), 'auto_discovery');
      }
    }

    logger.info('mercadolivre', 'Descoberta finalizada', {
      run_id: run.id,
      found,
      filtered,
      generated,
      scheduled,
      errors: errors.length,
    }, 'auto_discovery');

    AutoDiscoveryRun.update(run.id, {
      status: 'done',
      found,
      filtered,
      generated,
      sent,
      scheduled,
      errors_json: errors.length ? JSON.stringify(errors.slice(0, 20)) : null,
      finished_at: new Date().toISOString()
    });

    return { runId: run.id, found, filtered, generated, sent, scheduled };
  } catch (e) {
    logger.error('mercadolivre', 'Descoberta falhou', logger.errorMeta(e, {
      run_id: run.id,
      found,
      filtered,
      generated,
      scheduled,
    }), 'auto_discovery');
    AutoDiscoveryRun.update(run.id, {
      status: 'failed',
      found,
      filtered,
      generated,
      sent,
      scheduled,
      errors_json: JSON.stringify([e.message]),
      finished_at: new Date().toISOString()
    });
    throw e;
  }
}

module.exports = { runOnce, cleanupCandidates };
