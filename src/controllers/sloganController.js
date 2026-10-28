const Slogan = require('../models/Slogan');
const logger = require('../services/logger');
const LIMIT = 50;

exports.create = (req, res, next) => {
  try {
    if (Slogan.count() >= LIMIT) throw Object.assign(new Error(`Limite de ${LIMIT} slogans atingido.`), { status: 400 });
    if (!req.body.text?.trim()) throw Object.assign(new Error('Texto é obrigatório.'), { status: 400 });
    const created = Slogan.create(req.body);
    logger.info('slogans', 'Slogan criado', { slogan_id: created?.id, text: req.body.text }, 'slogans');
    res.redirect('/templates#slogans');
  } catch (err) { next(err); }
};

exports.update = (req, res, next) => {
  try {
    Slogan.update(Number(req.params.id), req.body);
    logger.info('slogans', 'Slogan atualizado', { slogan_id: req.params.id }, 'slogans');
    res.redirect('/templates#slogans');
  } catch (err) { next(err); }
};

exports.remove = (req, res) => { Slogan.remove(Number(req.params.id)); logger.info('slogans', 'Slogan removido', { slogan_id: req.params.id }, 'slogans'); res.redirect('/templates#slogans'); };
