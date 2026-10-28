const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(process.env.DB_PATH || './data/promoflow.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEFAULT_TEMPLATE = `🚀 *OFERTA IMPERDÍVEL!* 🚀

{{#title}}🛍️ *{{title}}*{{/title}}

{{#slogan}}✨ {{slogan}}{{/slogan}}

{{#original_price}}💰 De: ~R$ {{original_price}}~{{/original_price}}
🔥 *Por apenas:* R$ {{price}}

{{#coupon}}Use o Cupom: *{{coupon.code}}* 🎟️ + Selecione Pix{{/coupon}}

🔗 *Garanta o seu:* {{url}}

⏳ Aproveite antes que a oferta acabe!`;

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      platform TEXT NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS slogans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      external_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(platform, external_id)
    );
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      final_url TEXT,
      store TEXT,
      sku TEXT,
      title TEXT,
      original_price REAL,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      image_url TEXT,
      coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
      slogan_id INTEGER REFERENCES slogans(id) ON DELETE SET NULL,
      template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS promotion_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
      group_ids TEXT NOT NULL,              
      scheduled_at TEXT NOT NULL,           
      status TEXT NOT NULL DEFAULT 'pending', 
      source TEXT NOT NULL DEFAULT 'manual',
      report TEXT,                          
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      sent_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auto_discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      rules_json TEXT,
      found INTEGER NOT NULL DEFAULT 0,
      filtered INTEGER NOT NULL DEFAULT 0,
      generated INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      scheduled INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auto_discovery_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES auto_discovery_runs(id) ON DELETE SET NULL,
      store TEXT NOT NULL DEFAULT 'mercadolivre',
      url TEXT NOT NULL,
      final_url TEXT,
      sku TEXT,
      title TEXT,
      price REAL,
      original_price REAL,
      discount_percent REAL,
      image_url TEXT,
      is_most_sold INTEGER NOT NULL DEFAULT 0,
      has_extra_gain INTEGER NOT NULL DEFAULT 0,
      extra_gain_text TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
      reason TEXT,
      seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      key TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS auto_discovery_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS ml_coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      store TEXT NOT NULL DEFAULT 'mercadolivre',
      title TEXT,
      description TEXT,
      rules_text TEXT,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      min_purchase REAL,
      max_discount REAL,
      valid_until TEXT,
      terms_url TEXT,
      source_url TEXT,
      applies_to TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      auto_publish INTEGER NOT NULL DEFAULT 0,
      last_published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ml_coupon_publish_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ml_coupon_id INTEGER,
      group_ids TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      report_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ml_coupon_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS coupon_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_ids TEXT NOT NULL,
      coupon_ids TEXT NOT NULL,
      message TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      report TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      sent_at TEXT,
      sent_at_epoch INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_coupon_batches_due ON coupon_batches(status, scheduled_at);
    CREATE TABLE IF NOT EXISTS ml_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT,
      refresh_token TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ml_oauth_pending (
      state TEXT PRIMARY KEY,
      code_verifier TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL DEFAULT 'sistema',
      message TEXT NOT NULL,
      details TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_epoch DESC);
    CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category, level, created_epoch DESC);
  `);
  ensureColumn('auto_discovery_runs', 'scheduled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('schedules', 'sent_at_epoch', 'INTEGER');
  const hadScheduleSource = db.prepare('PRAGMA table_info(schedules)').all().some(c => c.name === 'source');
  ensureColumn('schedules', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  if (!hadScheduleSource) {
    try {
      db.prepare(`UPDATE schedules SET source = 'auto'
        WHERE promotion_id IN (
          SELECT promotion_id FROM auto_discovery_candidates WHERE promotion_id IS NOT NULL
        )`).run();
    } catch (e) {}
  }
  ensureColumn('ml_coupons', 'queued_at', 'TEXT');
  ensureColumn('coupons', 'min_purchase', 'REAL');
  ensureColumn('coupons', 'max_discount', 'REAL');
  ensureColumn('coupons', 'rules_text', 'TEXT');
  ensureColumn('coupons', 'source', 'TEXT');
  ensureColumn('coupons', 'valid_until', 'TEXT');
  ensureColumn('promotions', 'affiliate_url', 'TEXT');
  ensureColumn('ml_coupons', 'exhausted_at', 'TEXT');
  ensureColumn('ml_coupons', 'exhausted_notified_at', 'TEXT');
  try {
    db.prepare(`UPDATE auto_discovery_runs
      SET status = 'failed', errors_json = ?, finished_at = ?
      WHERE status = 'running'`)
      .run(JSON.stringify(['Execução interrompida pelo reinício do servidor']), new Date().toISOString());
  } catch (e) {}
  seedAutoDiscovery();
  seedMlCoupons();
  seed();
  upgradeCouponTemplate();
}

function upgradeCouponTemplate() {
  try {
    const oldLine = '{{#coupon}}🎟️ Cupom: *{{coupon.code}}* ({{coupon.label}}){{/coupon}}';
    const newLine = '{{#coupon}}Use o Cupom: *{{coupon.code}}* 🎟️ + Selecione Pix{{/coupon}}';
    const rows = db.prepare('SELECT id, content FROM templates WHERE content LIKE ?').all(`%${oldLine}%`);
    const update = db.prepare('UPDATE templates SET content = ? WHERE id = ?');
    for (const row of rows) update.run(row.content.replace(oldLine, newLine), row.id);
  } catch (e) {
    console.error('[DB] template de cupom:', e.message);
  }
}

function ensureColumn(table, column, definition) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    console.error(`[DB] coluna ${table}.${column}:`, e.message);
  }
}

function seedAutoDiscovery() {
  const has = db.prepare("SELECT COUNT(*) AS c FROM auto_discovery_config").get().c;
  if (!has) {
    const ins = db.prepare("INSERT INTO auto_discovery_config (key, value) VALUES (?, ?)");
    ins.run('enabled', 'true');
    ins.run('auto_send', 'true');
    ins.run('interval_minutes', '45');
    ins.run('max_per_run', '12');
    ins.run('min_discount', '0');
    ins.run('max_price', '0');
    ins.run('min_price', '0');
    ins.run('prefer_extra_gain', 'true');
    ins.run('prefer_most_sold', 'true');
    ins.run('require_extra_gain', 'false');
    ins.run('require_most_sold', 'false');
    ins.run('only_new', 'true');
    ins.run('allowed_stores', JSON.stringify(['mercadolivre']));
    ins.run('group_ids', JSON.stringify([]));
    ins.run('send_interval_minutes', '15');
    ins.run('send_start_hour', '8');
    ins.run('send_end_hour', '21');
  }
}

function seedMlCoupons() {
  const hasCfg = db.prepare('SELECT COUNT(*) AS c FROM ml_coupon_config').get().c;
  if (!hasCfg) {
    const ins = db.prepare('INSERT INTO ml_coupon_config (key, value) VALUES (?, ?)');
    ins.run('enabled', 'true');
    ins.run('auto_publish', 'true');
    ins.run('interval_minutes', '30');
    ins.run('max_publish_per_run', '3');
    ins.run('group_ids', JSON.stringify([]));
    ins.run('include_rules', 'true');
    ins.run('show_price_with_coupon', 'true');
  }
}

function seed() {
  const hasTemplate = db.prepare('SELECT COUNT(*) AS c FROM templates').get().c;
  if (!hasTemplate) {
    db.prepare('INSERT INTO templates (name, content, is_default) VALUES (?, ?, 1)').run('Padrão PromoFlow', DEFAULT_TEMPLATE);
  }
  const hasSlogan = db.prepare('SELECT COUNT(*) AS c FROM slogans').get().c;
  if (!hasSlogan) {
    const insert = db.prepare('INSERT INTO slogans (text) VALUES (?)');
    ['Frete Grátis', 'Oferta por Tempo Limitado', 'Preço Especial Hoje'].forEach(t => insert.run(t));
  }
}

module.exports = { db, initDatabase, DEFAULT_TEMPLATE };
