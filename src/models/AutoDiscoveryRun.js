const { db } = require('../config/database');

const AutoDiscoveryRun = {
  create(rules = {}) {
    const info = db.prepare('INSERT INTO auto_discovery_runs (rules_json) VALUES (?)').run(JSON.stringify(rules));
    return this.find(info.lastInsertRowid);
  },
  find(id) { return db.prepare('SELECT * FROM auto_discovery_runs WHERE id = ?').get(id); },
  update(id, data) {
    const sets = [];
    const values = { id };
    if (data.status !== undefined) { sets.push('status = @status'); values.status = data.status; }
    if (data.found !== undefined) { sets.push('found = @found'); values.found = data.found; }
    if (data.filtered !== undefined) { sets.push('filtered = @filtered'); values.filtered = data.filtered; }
    if (data.generated !== undefined) { sets.push('generated = @generated'); values.generated = data.generated; }
    if (data.sent !== undefined) { sets.push('sent = @sent'); values.sent = data.sent; }
    if (data.scheduled !== undefined) { sets.push('scheduled = @scheduled'); values.scheduled = data.scheduled; }
    if (data.errors_json !== undefined) { sets.push('errors_json = @errors_json'); values.errors_json = data.errors_json; }
    if (data.finished_at !== undefined) { sets.push('finished_at = @finished_at'); values.finished_at = data.finished_at; }
    if (!sets.length) return this.find(id);
    db.prepare(`UPDATE auto_discovery_runs SET ${sets.join(', ')} WHERE id = @id`).run(values);
    return this.find(id);
  },
  recent(limit = 10) { return db.prepare('SELECT * FROM auto_discovery_runs ORDER BY id DESC LIMIT ?').all(limit); },
};

module.exports = AutoDiscoveryRun;
