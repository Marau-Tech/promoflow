const Promotion = require('../../models/Promotion');
const Group = require('../../models/Group');
const telegram = require('./telegramService');
const whatsapp = require('./whatsappService');

const SENDERS = {
  telegram: (group, promo) => telegram.sendPromotion(group.external_id, promo),
  whatsapp: (group, promo) => whatsapp.sendPromotion(group.external_id, promo),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendToGroups(promotion, groupIds, { delayMs = 1500 } = {}) {
  const groups = Group.findByIds(groupIds.map(Number));
  const report = [];
  for (const group of groups) {
    const send = SENDERS[group.platform];
    try {
      if (!send) throw new Error(`Plataforma desconhecida: ${group.platform}`);
      await send(group, promotion);
      Promotion.logSend({ promotion_id: promotion.id, group_id: group.id, status: 'sent' });
      report.push({ group: group.name, platform: group.platform, ok: true });
    } catch (err) {
      Promotion.logSend({ promotion_id: promotion.id, group_id: group.id, status: 'failed', error: err.message });
      report.push({ group: group.name, platform: group.platform, ok: false, error: err.message });
    }
    await sleep(delayMs);
  }
  return report;
}

module.exports = { sendToGroups };
