const { db } = require('../config/database');

const Template = {
  all() { return db.prepare('SELECT * FROM templates ORDER BY is_default DESC, created_at DESC').all(); },
  find(id) { return db.prepare('SELECT * FROM templates WHERE id = ?').get(id); },
  getDefault() { return db.prepare('SELECT * FROM templates WHERE is_default = 1').get() || this.all()[0]; },
  count() { return db.prepare('SELECT COUNT(*) AS c FROM templates').get().c; },
  create({ name, content }) {
    const r = db.prepare('INSERT INTO templates (name, content) VALUES (?, ?)').run(name.trim(), content);
    return this.find(r.lastInsertRowid);
  },
  update(id, { name, content }) {
    db.prepare('UPDATE templates SET name=?, content=? WHERE id=?').run(name.trim(), content, id);
    return this.find(id);
  },
  setDefault(id) {
    db.transaction(() => {
      db.prepare('UPDATE templates SET is_default = 0').run();
      db.prepare('UPDATE templates SET is_default = 1 WHERE id = ?').run(id);
    })();
  },
  remove(id) {
    const t = this.find(id);
    if (!t) return;
    if (t.is_default) throw Object.assign(new Error('Não é possível excluir o template padrão.'), { status: 400 });
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  },
};

module.exports = Template;
