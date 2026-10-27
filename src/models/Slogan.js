const { db } = require('../config/database');

const Slogan = {
  all() { return db.prepare('SELECT * FROM slogans ORDER BY created_at ASC').all(); },
  active() { return db.prepare('SELECT * FROM slogans WHERE active = 1').all(); },
  find(id) { return db.prepare('SELECT * FROM slogans WHERE id = ?').get(id); },
  random() { return db.prepare('SELECT * FROM slogans WHERE active = 1 ORDER BY RANDOM() LIMIT 1').get() || null; },
  count() { return db.prepare('SELECT COUNT(*) AS c FROM slogans').get().c; },
  create({ text }) {
    const r = db.prepare('INSERT INTO slogans (text) VALUES (?)').run(text.trim());
    return this.find(r.lastInsertRowid);
  },
  update(id, { text, active = 1 }) {
    db.prepare('UPDATE slogans SET text=?, active=? WHERE id=?').run(text.trim(), Number(active) ? 1 : 0, id);
    return this.find(id);
  },
  remove(id) { db.prepare('DELETE FROM slogans WHERE id = ?').run(id); },
};

module.exports = Slogan;
