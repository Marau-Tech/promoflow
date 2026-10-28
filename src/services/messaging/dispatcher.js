const Promotion = require('../../models/Promotion');
const Group = require('../../models/Group');
const telegram = require('./telegramService');
const whatsapp = require('./whatsappService');
const logger = require('../logger');
const promotionService = require('../promotionService');

const SENDERS = {
  telegram: (group, promo) => telegram.sendPromotion(group.external_id, promo),
  whatsapp: (group, promo) => whatsapp.sendPromotion(group.external_id, promo),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendMessageToGroups(message, groupIds, { delayMs = 1500, category = 'promocoes', source = 'dispatcher' } = {}) {
  const ids = (groupIds || []).map(Number);
  const groups = Group.findByIds(ids);
  const report = [];

  if (!groups.length) {
    logger.warn(category, 'Nenhum grupo válido encontrado para envio', { groupIds: ids }, source);
  } else if (groups.length !== ids.length) {
    logger.warn(category, 'Alguns grupos não existem mais', { requested: ids, found: groups.length }, source);
  }

  for (const group of groups) {
    const send = SENDERS[group.platform];
    try {
      if (!send) throw new Error(`Plataforma desconhecida: ${group.platform}`);
      await send(group, { message });
      logger.info(category, 'Mensagem enviada', {
        group: group.name,
        group_id: group.id,
        platform: group.platform,
        kind: 'message',
      }, source);
      report.push({ group: group.name, platform: group.platform, ok: true });
    } catch (err) {
      logger.error(category, `Falha ao enviar mensagem para ${group.name}`, logger.errorMeta(err, {
        group: group.name,
        group_id: group.id,
        platform: group.platform,
        kind: 'message',
      }), source);
      report.push({ group: group.name, platform: group.platform, ok: false, error: err.message });
    }
    await sleep(delayMs);
  }
  return report;
}

async function sendToGroups(promotion, groupIds, { delayMs = 1500, category = 'promocoes', source = 'dispatcher' } = {}) {
  const ids = (groupIds || []).map(Number);
  const groups = Group.findByIds(ids);
  const report = [];

  // Revalida cupom/preço no envio para não divulgar cupom indisponível.
  const target = promotion?.id ? await promotionService.prepareForSend(promotion) : promotion;

  if (!groups.length) {
    logger.warn(category, 'Nenhum grupo válido encontrado para envio', {
      promotion_id: promotion?.id,
      groupIds: ids,
    }, source);
  } else if (groups.length !== ids.length) {
    logger.warn(category, 'Alguns grupos não existem mais', {
      promotion_id: promotion?.id,
      requested: ids,
      found: groups.length,
    }, source);
  }

  for (const group of groups) {
    const send = SENDERS[group.platform];
    try {
      if (!send) throw new Error(`Plataforma desconhecida: ${group.platform}`);
      await send(group, target);
      Promotion.logSend({ promotion_id: target.id, group_id: group.id, status: 'sent' });
      logger.info(category, 'Promoção enviada', {
        promotion_id: target.id,
        title: target.title,
        group: group.name,
        group_id: group.id,
        platform: group.platform,
      }, source);
      report.push({ group: group.name, platform: group.platform, ok: true });
    } catch (err) {
      Promotion.logSend({ promotion_id: target.id, group_id: group.id, status: 'failed', error: err.message });
      logger.error(category, `Falha ao enviar promoção para ${group.name}`, logger.errorMeta(err, {
        promotion_id: target.id,
        title: target.title,
        group: group.name,
        group_id: group.id,
        platform: group.platform,
      }), source);
      report.push({ group: group.name, platform: group.platform, ok: false, error: err.message });
    }
    await sleep(delayMs);
  }
  return report;
}

module.exports = { sendToGroups, sendMessageToGroups };
