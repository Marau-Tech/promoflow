const { db } = require('../config/database');

const parse = row => row && { ...row, group_ids: JSON.parse(row.group_ids || '[]'), report: row.report ? JSON.parse(row.report) : null };

const Schedule = {
  find(id) {
    return parse(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id));
  },
  all(status = null) {
    const sql = `
      SELECT s.*, p.title, p.image_url, p.url, p.store FROM schedules s
      JOIN promotions p ON p.id = s.promotion_id
      ${status ? 'WHERE s.status = ?' : ''}
      ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.scheduled_at DESC`;
    const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
    return rows.map(parse);
  },
  due(now = new Date().toISOString()) {
    return db.prepare(`SELECT * FROM schedules WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at`).all(now).map(parse);
  },
  create({ promotion_id, group_ids, scheduled_at }) {
    const r = db.prepare('INSERT INTO schedules (promotion_id, group_ids, scheduled_at) VALUES (?, ?, ?)')
      .run(promotion_id, JSON.stringify(group_ids), scheduled_at);
    return this.find(r.lastInsertRowid);
  },
  markSent(id, report) {
    const failed = report.every(r => !r.ok);
    db.prepare(`UPDATE schedules SET status = ?, report = ?, sent_at = datetime('now','localtime') WHERE id = ?`)
      .run(failed ? 'failed' : 'sent', JSON.stringify(report), id);
  },
  markFailed(id, error) {
    db.prepare(`UPDATE schedules SET status = 'failed', error = ?, sent_at = datetime('now','localtime') WHERE id = ?`).run(error, id);
  },
  cancel(id) {
    db.prepare(`UPDATE schedules SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id);
  },
  remove(id) {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  },
  counts() {
    const rows = db.prepare('SELECT status, COUNT(*) AS c FROM schedules GROUP BY status').all();
    return Object.fromEntries(rows.map(r => [r.status, r.c]));
  },
};

module.exports = Schedule;