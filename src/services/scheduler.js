const Schedule = require('../models/Schedule');
const Promotion = require('../models/Promotion');
const dispatcher = require('./messaging/dispatcher');

const INTERVAL_MS = 30000;
let running = false;

async function tick() {
  if (running) return;          // evita sobreposição se um envio demorar
  running = true;
  try {
    for (const s of Schedule.due()) {
      const promotion = Promotion.find(s.promotion_id);
      if (!promotion) { Schedule.markFailed(s.id, 'Promoção não existe mais'); continue; }
      try {
        console.log(`[Agendamento] Enviando #${s.id} para ${s.group_ids.length} grupo(s)`);
        const report = await dispatcher.sendToGroups(promotion, s.group_ids);
        Schedule.markSent(s.id, report);
      } catch (err) {
        Schedule.markFailed(s.id, err.message);
      }
    }
  } finally {
    running = false;
  }
}

function start() {
  tick().catch(err => console.error('[Agendamento]', err.message));
  setInterval(() => tick().catch(err => console.error('[Agendamento]', err.message)), INTERVAL_MS);
  console.log('[Agendamento] Verificando envios a cada 30s');
}

module.exports = { start, tick };