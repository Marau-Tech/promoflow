const { db } = require('../config/database');

const Group = {
  all() { return db.prepare('SELECT * FROM groups ORDER BY platform, name').all(); },
  active() { return db.prepare('SELECT * FROM groups WHERE active = 1 ORDER BY platform, name').all(); },
  find(id) { return db.prepare('SELECT * FROM groups WHERE id = ?').get(id); },
  findByIds(ids) {
    if (!ids?.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM groups WHERE id IN (${placeholders})`).all(...ids);
  },
  upsert({ name, platform, external_id }) {
    db.prepare(`INSERT INTO groups (name, platform, external_id) VALUES (?, ?, ?)
                ON CONFLICT(platform, external_id) DO UPDATE SET name = excluded.name`)
      .run(name, platform, String(external_id));
  },
  toggle(id, active) { db.prepare('UPDATE groups SET active = ? WHERE id = ?').run(active ? 1 : 0, id); },
  remove(id) { db.prepare('DELETE FROM groups WHERE id = ?').run(id); },
};

module.exports = Group;
