const { db } = require('../config/database');

const parse = row => row && {
  ...row,
  group_ids: JSON.parse(row.group_ids || '[]'),
  coupon_ids: JSON.parse(row.coupon_ids || '[]'),
  report: row.report ? JSON.parse(row.report) : null,
};

const CouponBatch = {
  find(id) {
    return parse(db.prepare('SELECT * FROM coupon_batches WHERE id = ?').get(id));
  },
  all(status = null, limit = 100) {
    const sql = `
      SELECT * FROM coupon_batches
      ${status ? 'WHERE status = ?' : ''}
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
               CASE WHEN status = 'pending' THEN scheduled_at END ASC,
               scheduled_at DESC
      LIMIT ?
    `;
    const rows = status
      ? db.prepare(sql).all(status, limit)
      : db.prepare(sql).all(limit);
    return rows.map(parse);
  },
  due(now = new Date().toISOString()) {
    return db.prepare(`SELECT * FROM coupon_batches WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at`).all(now).map(parse);
  },
  allPending() {
    return db.prepare("SELECT * FROM coupon_batches WHERE status = 'pending' ORDER BY scheduled_at").all().map(parse);
  },
  reschedule(id, scheduledAt) {
    db.prepare("UPDATE coupon_batches SET scheduled_at = ? WHERE id = ? AND status = 'pending'").run(scheduledAt, id);
  },
  create({ group_ids, coupon_ids, message, scheduled_at }) {
    const r = db.prepare('INSERT INTO coupon_batches (group_ids, coupon_ids, message, scheduled_at) VALUES (?, ?, ?, ?)')
      .run(JSON.stringify(group_ids), JSON.stringify(coupon_ids), message, scheduled_at);
    return this.find(r.lastInsertRowid);
  },
  updateContent(id, { coupon_ids, message }) {
    db.prepare("UPDATE coupon_batches SET coupon_ids = ?, message = ? WHERE id = ? AND status = 'pending'")
      .run(JSON.stringify(coupon_ids), message, id);
  },
  markSent(id, report) {
    const failed = report.length > 0 && report.every(r => !r.ok);
    db.prepare(`UPDATE coupon_batches SET status = ?, report = ?, sent_at = datetime('now','localtime'), sent_at_epoch = ? WHERE id = ?`)
      .run(failed ? 'failed' : 'sent', JSON.stringify(report), Date.now(), id);
    return failed ? 'failed' : 'sent';
  },
  markFailed(id, error) {
    db.prepare(`UPDATE coupon_batches SET status = 'failed', error = ?, sent_at = datetime('now','localtime'), sent_at_epoch = ? WHERE id = ?`)
      .run(error, Date.now(), id);
  },
  cancel(id) {
    return db.prepare(`UPDATE coupon_batches SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id).changes;
  },
  cancelAll() {
    return db.prepare("UPDATE coupon_batches SET status = 'cancelled' WHERE status = 'pending'").run().changes;
  },
  remove(id) {
    return db.prepare('DELETE FROM coupon_batches WHERE id = ?').run(id).changes;
  },
  removeAll() {
    return db.prepare('DELETE FROM coupon_batches').run().changes;
  },
  lastPendingAt() {
    return db.prepare("SELECT MAX(scheduled_at) AS m FROM coupon_batches WHERE status = 'pending'").get()?.m || null;
  },
  lastSentEpoch() {
    return db.prepare("SELECT MAX(sent_at_epoch) AS m FROM coupon_batches WHERE status IN ('sent','failed')").get()?.m || null;
  },
  counts() {
    const rows = db.prepare('SELECT status, COUNT(*) AS c FROM coupon_batches GROUP BY status').all();
    return Object.fromEntries(rows.map(r => [r.status, r.c]));
  },
  countsSince(epoch) {
    const rows = db.prepare('SELECT status, COUNT(*) AS c FROM coupon_batches WHERE sent_at_epoch >= ? GROUP BY status').all(epoch);
    return Object.fromEntries(rows.map(r => [r.status, r.c]));
  },
};

module.exports = CouponBatch;
