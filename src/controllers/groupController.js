const Group = require('../models/Group');
const whatsapp = require('../services/messaging/whatsappService');
const telegram = require('../services/messaging/telegramService');
const logger = require('../services/logger');

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
  try {
    const groups = await whatsapp.listGroups();
    groups.forEach(g => Group.upsert(g));
    logger.info('grupos', 'Grupos do WhatsApp sincronizados', { count: groups.length }, 'groups');
    res.redirect('/grupos');
  } catch (err) {
    logger.error('whatsapp', 'Falha ao conectar/importar grupos do WhatsApp', logger.errorMeta(err), 'groups');
    res.locals.__errorLogged = true;
    next(err);
  }
};

exports.syncTelegram = async (req, res, next) => {
  try {
    const chats = await telegram.discoverChats();
    chats.forEach(g => Group.upsert(g));
    logger.info('grupos', 'Grupos do Telegram sincronizados', { count: chats.length }, 'groups');
    res.redirect('/grupos');
  } catch (err) {
    logger.error('telegram', 'Falha ao conectar/importar grupos do Telegram', logger.errorMeta(err), 'groups');
    res.locals.__errorLogged = true;
    next(err);
  }
};

exports.addTelegramManual = (req, res, next) => {
  try {
    const { name, external_id } = req.body;
    if (!name || !external_id) throw Object.assign(new Error('Nome e chat_id são obrigatórios'), { status: 400 });
    Group.upsert({ name, external_id, platform: 'telegram' });
    logger.info('grupos', 'Grupo do Telegram adicionado manualmente', { name, external_id }, 'groups');
    res.redirect('/grupos');
  } catch (err) {
    logger.error('grupos', 'Falha ao adicionar grupo do Telegram', logger.errorMeta(err, { name, external_id }), 'groups');
    res.locals.__errorLogged = true;
    next(err);
  }
};

exports.toggle = (req, res) => {
  const active = req.body.active === '1';
  Group.toggle(Number(req.params.id), active);
  logger.info('grupos', 'Status do grupo alterado', { group_id: req.params.id, active }, 'groups');
  res.redirect('/grupos');
};
exports.remove = (req, res) => {
  Group.remove(Number(req.params.id));
  logger.info('grupos', 'Grupo removido', { group_id: req.params.id }, 'groups');
  res.redirect('/grupos');
};
exports.removeMany = (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  const removed = Group.removeMany(ids);
  if (removed) logger.info('grupos', 'Grupos removidos em massa', { group_ids: ids, removed }, 'groups');
  res.redirect('/grupos');
};
exports.logoutWhatsapp = async (req, res, next) => {
  try {
    await whatsapp.logout();
    logger.info('whatsapp', 'Desconexão do WhatsApp solicitada', null, 'groups');
    res.redirect('/grupos');
  } catch (err) {
    logger.error('whatsapp', 'Falha ao desconectar WhatsApp', logger.errorMeta(err), 'groups');
    res.locals.__errorLogged = true;
    next(err);
  }
};
