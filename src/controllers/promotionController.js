const promotionService = require('../services/promotionService');
const dispatcher = require('../services/messaging/dispatcher');
const Promotion = require('../models/Promotion');
const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const Group = require('../models/Group');
const { STORES } = require('../services/scraper/storeDetector');

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
    if (autoSend && groupIds.length) {
      for (const r of results.filter(x => x.ok)) {
        r.sendReport = await dispatcher.sendToGroups(r.promotion, groupIds);
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try { res.json({ promotion: promotionService.updatePromotion(Number(req.params.id), req.body) }); }
  catch (err) { next(err); }
};

exports.send = async (req, res, next) => {
  try {
    const promotion = Promotion.find(Number(req.params.id));
    if (!promotion) return res.status(404).json({ error: 'Promoção não encontrada' });
    const { groupIds = [] } = req.body;
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });
    res.json({ report: await dispatcher.sendToGroups(promotion, groupIds) });
  } catch (err) { next(err); }
};
