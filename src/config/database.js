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

{{#coupon}}🎟️ Cupom: *{{coupon.code}}* ({{coupon.label}}){{/coupon}}

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
  `);
  seed();
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
