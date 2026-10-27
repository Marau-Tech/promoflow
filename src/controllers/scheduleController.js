const Schedule = require('../models/Schedule');
const Promotion = require('../models/Promotion');
const Group = require('../models/Group');

const MAX_DAYS = 10;

exports.index = (req, res) => {
  const status = ['pending', 'sent', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const groups = Object.fromEntries(Group.all().map(g => [g.id, g]));
  res.render('schedules/index', {
    title: 'Agendamentos',
    schedules: Schedule.all(status).map(s => ({ ...s, groups: s.group_ids.map(id => groups[id]).filter(Boolean) })),
    status,
    counts: Schedule.counts(),
  });
};

/** POST /api/schedules { promotionId, groupIds, scheduledAt (ISO) } */
exports.create = (req, res, next) => {
  try {
    const { promotionId, groupIds = [], scheduledAt } = req.body;
    const promotion = Promotion.find(Number(promotionId));
    if (!promotion) return res.status(404).json({ error: 'Promoção não encontrada' });
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Data/hora inválida.' });
    if (when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'A data precisa ser no futuro.' });
    if (when.getTime() > Date.now() + MAX_DAYS * 86400000) return res.status(400).json({ error: `Máximo de ${MAX_DAYS} dias a partir de hoje.` });

    const schedule = Schedule.create({ promotion_id: promotion.id, group_ids: groupIds.map(Number), scheduled_at: when.toISOString() });
    res.json({ schedule });
  } catch (err) { next(err); }
};

/** POST /api/schedules/batch { promotionIds:[], groupIds:[], startAt (ISO), intervalMinutes } */
exports.createBatch = (req, res, next) => {
  try {
    const { promotionIds = [], groupIds = [], startAt, intervalMinutes = 15 } = req.body;
    if (!promotionIds.length) return res.status(400).json({ error: 'Nenhuma promoção para agendar.' });
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });

    const interval = Math.max(1, Number(intervalMinutes) || 15);
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Data/hora de início inválida.' });
    if (start.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'O início precisa ser agora ou no futuro.' });

    const last = start.getTime() + (promotionIds.length - 1) * interval * 60000;
    if (last > Date.now() + MAX_DAYS * 86400000) {
      return res.status(400).json({ error: `Com esse intervalo o último envio passa do limite de ${MAX_DAYS} dias.` });
    }

    const created = [];
    promotionIds.forEach((pid, i) => {
      const promotion = Promotion.find(Number(pid));
      if (!promotion) return;
      const when = new Date(start.getTime() + i * interval * 60000).toISOString();
      created.push(Schedule.create({ promotion_id: promotion.id, group_ids: groupIds.map(Number), scheduled_at: when }));
    });

    res.json({ created: created.length, first: created[0]?.scheduled_at, last: created.at(-1)?.scheduled_at });
  } catch (err) { next(err); }
};

exports.cancel = (req, res) => { Schedule.cancel(Number(req.params.id)); res.redirect('/agendamentos'); };
exports.remove = (req, res) => { Schedule.remove(Number(req.params.id)); res.redirect('/agendamentos'); };