const Coupon = require('../models/Coupon');
const { STORES } = require('../services/scraper/storeDetector');
const LIMIT = 25;

exports.index = (req, res) => {
  res.render('coupons/index', {
    title: 'Meus Cupons',
    coupons: Coupon.all(),
    stores: STORES,
    limit: LIMIT,
    count: Coupon.count(),
    editing: req.query.edit ? Coupon.find(Number(req.query.edit)) : null,
  });
};

exports.create = (req, res, next) => {
  try {
    if (Coupon.count() >= LIMIT) throw Object.assign(new Error(`Limite de ${LIMIT} cupons atingido.`), { status: 400 });
    if (!req.body.code?.trim()) throw Object.assign(new Error('Código é obrigatório.'), { status: 400 });
    Coupon.create(req.body);
    res.redirect('/cupons');
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try {
    Coupon.update(Number(req.params.id), { ...req.body, active: req.body.active === 'on' || req.body.active === '1' });
    res.redirect('/cupons');
  } catch (err) { next(err); }
};

exports.remove = (req, res) => { Coupon.remove(Number(req.params.id)); res.redirect('/cupons'); };
