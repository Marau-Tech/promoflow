const { db } = require('../config/database');

const MAX_LIMIT = 1000;

function parseLimit(value, fallback = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function buildWhere(filters = {}) {
  const where = [];
  const params = [];
  if (filters.level) { where.push('level = ?'); params.push(filters.level); }
  if (filters.category) { where.push('category = ?'); params.push(filters.category); }
  if (filters.q) {
    where.push('(message LIKE ? OR details LIKE ? OR source LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  if (filters.fromEpoch) { where.push('created_epoch >= ?'); params.push(filters.fromEpoch); }
  if (filters.toEpoch) { where.push('created_epoch <= ?'); params.push(filters.toEpoch); }
  return { where, params };
}

const SystemLog = {
  all(filters = {}) {
    const { where, params } = buildWhere(filters);
    let sql = 'SELECT * FROM system_logs';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY created_epoch DESC, id DESC LIMIT ?';
    params.push(parseLimit(filters.limit));

    return db.prepare(sql).all(...params);
  },

  find(id) {
    return db.prepare('SELECT * FROM system_logs WHERE id = ?').get(id);
  },

  count(filters = {}) {
    const { where, params } = buildWhere(filters);
    let sql = 'SELECT COUNT(*) AS c FROM system_logs';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    return db.prepare(sql).get(...params).c;
  },

  stats() {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const rows = db.prepare(`
      SELECT level, COUNT(*) AS count
      FROM system_logs
      WHERE created_epoch >= ?
      GROUP BY level
    `).all(since);
    const out = { total: 0, error: 0, warn: 0, info: 0 };
    for (const row of rows) {
      out[row.level] = row.count;
      out.total += row.count;
    }
    return out;
  },

  countsByCategory(filters = {}) {
    const { where, params } = buildWhere(filters);
    let sql = `
      SELECT category, COUNT(*) AS count
      FROM system_logs
    `;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' GROUP BY category ORDER BY count DESC';
    return db.prepare(sql).all(...params);
  },

  clearOlderThan(days = 30) {
    const cutoff = Date.now() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
    const result = db.prepare('DELETE FROM system_logs WHERE created_epoch < ?').run(cutoff);
    return result.changes;
  },
};

module.exports = SystemLog;
