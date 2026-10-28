const { db } = require('../../config/database');

function getConfig() {
  const rows = db.prepare('SELECT key, value FROM auto_discovery_config').all();
  const cfg = {
    enabled: true,
    auto_send: true,
    interval_minutes: 30,
    max_per_run: 20,
    min_discount: 0,
    min_price: 0,
    max_price: 0,
    prefer_extra_gain: true,
    prefer_most_sold: true,
    require_extra_gain: false,
    require_most_sold: false,
    only_new: true,
    allowed_stores: ['mercadolivre'],
    group_ids: [],
    affiliate_url: '',
    send_interval_minutes: 15,
    send_start_hour: 8,
    send_end_hour: 21
  };
  for (const r of rows) {
    try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; }
  }
  if (typeof cfg.allowed_stores === 'string') {
    try { cfg.allowed_stores = JSON.parse(cfg.allowed_stores); } catch {}
  }
  if (typeof cfg.group_ids === 'string') {
    try { cfg.group_ids = JSON.parse(cfg.group_ids); } catch { cfg.group_ids = []; }
  }
  cfg.group_ids = (Array.isArray(cfg.group_ids) ? cfg.group_ids : []).map(Number).filter(Boolean);
  return cfg;
}

function setConfig(updates = {}) {
  const stmt = db.prepare('INSERT INTO auto_discovery_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(updates)) {
    stmt.run(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return getConfig();
}

module.exports = { getConfig, setConfig };
