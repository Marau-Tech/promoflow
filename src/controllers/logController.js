const SystemLog = require('../models/SystemLog');
const logger = require('../services/logger');

const LEVELS = ['error', 'warn', 'info'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilters(query = {}) {
  const level = LEVELS.includes(query.level) ? query.level : null;
  const category = logger.CATEGORIES[query.category] ? query.category : null;
  const q = String(query.q || '').trim().slice(0, 120);
  const from = DATE_RE.test(query.from || '') ? query.from : null;
  const to = DATE_RE.test(query.to || '') ? query.to : null;
  const limit = Math.min(Math.max(Number(query.limit) || 200, 25), 1000);

  const fromEpoch = from ? new Date(`${from}T00:00:00-03:00`).getTime() : null;
  const toEpoch = to ? new Date(`${to}T23:59:59.999-03:00`).getTime() : null;

  return { level, category, q, from, to, limit, fromEpoch, toEpoch };
}

exports.index = (req, res) => {
  const filters = parseFilters(req.query);
  const logs = SystemLog.all(filters);
  res.render('logs/index', {
    title: 'Logs & Erros',
    logs,
    filters,
    categories: logger.CATEGORIES,
    levels: logger.LEVELS,
    stats: SystemLog.stats(),
    categoryCounts: SystemLog.countsByCategory(),
    totalFiltered: SystemLog.count(filters),
  });
};

exports.exportCsv = (req, res) => {
  const filters = parseFilters({ ...req.query, limit: 1000 });
  const logs = SystemLog.all(filters);
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['data_hora', 'nivel', 'categoria', 'mensagem', 'origem', 'detalhes'];
  const rows = logs.map(l => [
    l.created_at,
    l.level,
    logger.CATEGORIES[l.category] || l.category,
    l.message,
    l.source || '',
    l.details || '',
  ].map(escape).join(';'));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="promoflow-logs.csv"');
  res.send(`\uFEFF${[header.join(';'), ...rows].join('\n')}`);
};

exports.clear = (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
  const removed = SystemLog.clearOlderThan(days);
  logger.info('sistema', 'Logs antigos removidos', { days, removed }, 'logs');
  res.redirect('/logs');
};
