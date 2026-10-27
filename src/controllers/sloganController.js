const Slogan = require('../models/Slogan');
const LIMIT = 50;

exports.create = (req, res, next) => {
  try {
    if (Slogan.count() >= LIMIT) throw Object.assign(new Error(`Limite de ${LIMIT} slogans atingido.`), { status: 400 });
    if (!req.body.text?.trim()) throw Object.assign(new Error('Texto é obrigatório.'), { status: 400 });
    Slogan.create(req.body);
    res.redirect('/templates#slogans');
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try { Slogan.update(Number(req.params.id), req.body); res.redirect('/templates#slogans'); } catch (err) { next(err); }
};

exports.remove = (req, res) => { Slogan.remove(Number(req.params.id)); res.redirect('/templates#slogans'); };
