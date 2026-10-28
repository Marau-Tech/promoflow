const promotionService = require('../services/promotionService');
const dispatcher = require('../services/messaging/dispatcher');
const Promotion = require('../models/Promotion');
const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const Group = require('../models/Group');
const { STORES } = require('../services/scraper/storeDetector');
const logger = require('../services/logger');

exports.index = (req, res) => {
  res.render('promotions/index', {
    title: 'Gerar Promoção',
    templates: Template.all(),
    slogans: Slogan.active(),
    groups: Group.active(),
    stores: STORES,
    storePatterns: STORES.map(s => ({ key: s.key, label: s.label, pattern: s.pattern.source })),
    maxLinks: promotionService.MAX_LINKS,
  });
};

exports.generate = async (req, res, next) => {
  try {
    const { links = [], templateId, autoSend = false, groupIds = [], storeHint = null } = req.body;
    if (!Array.isArray(links) || !links.length) return res.status(400).json({ error: 'Informe pelo menos um link.' });
    const results = await promotionService.generateFromLinks({ links, templateId, storeHint });
    const failed = results.filter(r => !r.ok);
    logger.info('promocoes', 'Promoções geradas', {
      links: links.length,
      generated: results.length - failed.length,
      failed: failed.length,
    }, 'promotions');
    for (const r of failed) {
      logger.warn('promocoes', 'Falha ao gerar promoção', { url: r.url, error: r.error }, 'promotions');
    }
    if (autoSend && groupIds.length) {
      for (const r of results.filter(x => x.ok)) {
        r.sendReport = await dispatcher.sendToGroups(r.promotion, groupIds, { category: 'promocoes', source: 'promotions' });
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try {
    const promotion = promotionService.updatePromotion(Number(req.params.id), req.body);
    logger.info('promocoes', 'Promoção atualizada', { promotion_id: promotion.id }, 'promotions');
    res.json({ promotion });
  } catch (err) { next(err); }
};

exports.send = async (req, res, next) => {
  try {
    const promotion = Promotion.find(Number(req.params.id));
    if (!promotion) return res.status(404).json({ error: 'Promoção não encontrada' });
    const { groupIds = [] } = req.body;
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });
    logger.info('promocoes', 'Envio manual solicitado', { promotion_id: promotion.id, groups: groupIds.length }, 'promotions');
    res.json({ report: await dispatcher.sendToGroups(promotion, groupIds, { category: 'promocoes', source: 'promotions' }) });
  } catch (err) { next(err); }
};
