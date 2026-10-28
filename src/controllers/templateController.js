const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const templateEngine = require('../services/templateEngine');
const logger = require('../services/logger');
const LIMIT = 10;

const SAMPLE = {
  title: 'Aparelho medidor de pressão digital de braço',
  price: '98,86', price_with_coupon: '98,86', original_price: '298,94', url: 'https://exemplo.com/produto', store: 'Mercado Livre',
  sku: 'MLB24000050', slogan: 'Frete Grátis', discount_percent: 67,
  coupon: { code: 'PROMO10', label: '10% OFF', description: '' },
};

exports.index = (req, res) => {
  res.render('templates/index', {
    title: 'Templates de Promoção',
    templates: Template.all(),
    slogans: Slogan.all(),
    limit: LIMIT,
    count: Template.count(),
    editing: req.query.edit ? Template.find(Number(req.query.edit)) : null,
  });
};

exports.create = (req, res, next) => {
  try {
    if (Template.count() >= LIMIT) throw Object.assign(new Error(`Limite de ${LIMIT} templates atingido.`), { status: 400 });
    const created = Template.create(req.body);
    logger.info('templates', 'Template criado', { template_id: created?.id, name: req.body.name }, 'templates');
    res.redirect('/templates');
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try {
    Template.update(Number(req.params.id), req.body);
    logger.info('templates', 'Template atualizado', { template_id: req.params.id }, 'templates');
    res.redirect('/templates');
  } catch (err) { next(err); }
};

exports.setDefault = (req, res) => { Template.setDefault(Number(req.params.id)); logger.info('templates', 'Template padrão alterado', { template_id: req.params.id }, 'templates'); res.redirect('/templates'); };

exports.remove = (req, res, next) => {
  try {
    Template.remove(Number(req.params.id));
    logger.info('templates', 'Template removido', { template_id: req.params.id }, 'templates');
    res.redirect('/templates');
  } catch (err) { next(err); }
};

exports.preview = (req, res) => {
  res.json({ preview: templateEngine.render(req.body.content || '', SAMPLE) });
};
