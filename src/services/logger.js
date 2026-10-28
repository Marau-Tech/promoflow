const { db } = require('../config/database');

const CATEGORIES = {
  sistema: 'Sistema',
  api: 'API / Rotas',
  promocoes: 'Promoções',
  agendamentos: 'Agendamentos',
  mercadolivre: 'Mercado Livre',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  cupons_ml: 'Cupons ML',
  cupons: 'Cupons',
  grupos: 'Grupos',
  templates: 'Templates',
  slogans: 'Slogans',
  scraper: 'Scraper',
  banco: 'Banco de dados',
};

const LEVELS = { error: 'Erro', warn: 'Aviso', info: 'Info' };
const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|cookie|session)/i;
const onceCache = new Map();

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeJson(value) {
  if (value === undefined || value === null) return null;
  const seen = new WeakSet();
  try {
    const json = JSON.stringify(value, (key, val) => {
      if (key && SENSITIVE_KEY.test(key)) return '[redacted]';
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      if (typeof val === 'bigint') return String(val);
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[circular]';
        seen.add(val);
      }
      return val;
    }, 2);
    return truncate(json, 12000);
  } catch (e) {
    return truncate(String(value), 12000);
  }
}

function normalizeCategory(category) {
  return CATEGORIES[category] ? category : 'sistema';
}

function errorMeta(err, extra = {}) {
  const meta = { ...extra };
  if (!err) return meta;
  meta.error = err.message || String(err);
  if (err.code) meta.code = err.code;
  if (err.status) meta.status = err.status;
  if (err.response) {
    meta.http_status = err.response.status;
    if (err.response.data !== undefined) meta.response = err.response.data;
  }
  if (err.config?.url) meta.url = err.config.url;
  if (err.stack) meta.stack = String(err.stack).split('\n').slice(0, 7).join('\n');
  return meta;
}

function write(level, category, message, meta, source) {
  const cat = normalizeCategory(category);
  const lvl = LEVELS[level] ? level : 'info';
  const msg = truncate(message || '(sem mensagem)', 2000);
  const details = safeJson(meta);
  const src = source ? truncate(source, 180) : null;

  try {
    db.prepare(`
      INSERT INTO system_logs (level, category, message, details, source, created_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lvl, cat, msg, details, src, Date.now());
  } catch (e) {
    console.error('[Logger] falha ao gravar log:', e.message);
  }

  const tag = `[${CATEGORIES[cat]}]`;
  if (lvl === 'error') console.error(tag, msg, meta || '');
  else if (lvl === 'warn') console.warn(tag, msg, meta || '');
  else if (process.env.LOG_DEBUG === 'true') console.log(tag, msg, meta || '');
}

function once(key, ttlMs, level, category, message, meta, source) {
  const now = Date.now();
  const hit = onceCache.get(key);
  if (hit && hit > now) return;
  onceCache.set(key, now + ttlMs);
  if (onceCache.size > 1000) {
    for (const [k, exp] of onceCache) if (exp <= now) onceCache.delete(k);
  }
  write(level, category, message, meta, source);
}

module.exports = {
  CATEGORIES,
  LEVELS,
  error: (category, message, meta, source) => write('error', category, message, meta, source),
  warn: (category, message, meta, source) => write('warn', category, message, meta, source),
  info: (category, message, meta, source) => write('info', category, message, meta, source),
  once,
  errorMeta,
};
