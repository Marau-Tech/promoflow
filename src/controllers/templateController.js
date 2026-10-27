const Template = require('../models/Template');
const Slogan = require('../models/Slogan');
const templateEngine = require('../services/templateEngine');
const LIMIT = 10;

const SAMPLE = {
  title: 'Aparelho medidor de pressão digital de braço',
  price: '109,84', original_price: '298,94', url: 'https://exemplo.com/produto', store: 'Mercado Livre',
  sku: 'MLB24000050', slogan: 'Frete Grátis', discount_percent: 63,
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
    Template.create(req.body);
    res.redirect('/templates');
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try { Template.update(Number(req.params.id), req.body); res.redirect('/templates'); } catch (err) { next(err); }
};

exports.setDefault = (req, res) => { Template.setDefault(Number(req.params.id)); res.redirect('/templates'); };

exports.remove = (req, res, next) => {
  try { Template.remove(Number(req.params.id)); res.redirect('/templates'); } catch (err) { next(err); }
};

exports.preview = (req, res) => {
  res.json({ preview: templateEngine.render(req.body.content || '', SAMPLE) });
};
