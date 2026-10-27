const Group = require('../models/Group');
const whatsapp = require('../services/messaging/whatsappService');
const telegram = require('../services/messaging/telegramService');

exports.index = (req, res) => {
  res.render('groups/index', {
    title: 'Grupos',
    groups: Group.all(),
    whatsapp: whatsapp.getState(),
    whatsappEnabled: process.env.WHATSAPP_ENABLED === 'true',
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
};

exports.whatsappStatus = (req, res) => res.json(whatsapp.getState());

exports.syncWhatsapp = async (req, res, next) => {
  try { (await whatsapp.listGroups()).forEach(g => Group.upsert(g)); res.redirect('/grupos'); } catch (err) { next(err); }
};

exports.syncTelegram = async (req, res, next) => {
  try { (await telegram.discoverChats()).forEach(g => Group.upsert(g)); res.redirect('/grupos'); } catch (err) { next(err); }
};

exports.addTelegramManual = (req, res, next) => {
  try {
    const { name, external_id } = req.body;
    if (!name || !external_id) throw Object.assign(new Error('Nome e chat_id são obrigatórios'), { status: 400 });
    Group.upsert({ name, external_id, platform: 'telegram' });
    res.redirect('/grupos');
  } catch (err) { next(err); }
};

exports.toggle = (req, res) => { Group.toggle(Number(req.params.id), req.body.active === '1'); res.redirect('/grupos'); };
exports.remove = (req, res) => { Group.remove(Number(req.params.id)); res.redirect('/grupos'); };
exports.logoutWhatsapp = async (req, res, next) => {
  try { await whatsapp.logout(); res.redirect('/grupos'); } catch (err) { next(err); }
};
