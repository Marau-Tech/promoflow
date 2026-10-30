const { db } = require('../config/database');

const MLCoupon = {
  all() { try { return db.prepare('SELECT * FROM ml_coupons ORDER BY id DESC').all(); } catch(e){ return []; } },
  active() { try { return db.prepare("SELECT * FROM ml_coupons WHERE active = 1 ORDER BY discount_value DESC").all(); } catch(e){ return []; } },
  pendingAuto() {
    try {
      return db.prepare(`SELECT * FROM ml_coupons
        WHERE active = 1 AND auto_publish = 1
          AND last_published_at IS NULL AND queued_at IS NULL
        ORDER BY discount_value DESC`).all();
    } catch (e) { return []; }
  },
  findByCode(code) { try { return db.prepare('SELECT * FROM ml_coupons WHERE UPPER(code)=UPPER(?)').get(code); } catch(e){ return null; } },
  upsert(data) {
    try {
      const existing = this.findByCode(data.code);
      if (existing) {
        db.prepare(`UPDATE ml_coupons SET title=@title, description=@description, rules_text=@rules_text, discount_type=@discount_type, discount_value=@discount_value, min_purchase=@min_purchase, max_discount=@max_discount, valid_until=@valid_until, terms_url=@terms_url, source_url=@source_url, applies_to=@applies_to, active=1, exhausted_at=NULL, exhausted_notified_at=NULL, updated_at=datetime('now','localtime') WHERE id=@id`)
          .run({ id: existing.id, title:data.title||null, description:data.description||null, rules_text:data.rules_text||null, discount_type:data.discount_type||'percent', discount_value:data.discount_value||0, min_purchase:data.min_purchase||null, max_discount:data.max_discount||null, valid_until:data.valid_until||null, terms_url:data.terms_url||null, source_url:data.source_url||null, applies_to:data.applies_to||null });
        return this.findByCode(data.code);
      }
      const r = db.prepare(`INSERT INTO ml_coupons (code, store, title, description, rules_text, discount_type, discount_value, min_purchase, max_discount, valid_until, terms_url, source_url, applies_to)
        VALUES (@code, @store, @title, @description, @rules_text, @discount_type, @discount_value, @min_purchase, @max_discount, @valid_until, @terms_url, @source_url, @applies_to)`)
        .run({ code:data.code, store:'mercadolivre', title:data.title||null, description:data.description||null, rules_text:data.rules_text||null, discount_type:data.discount_type||'percent', discount_value:data.discount_value||0, min_purchase:data.min_purchase||null, max_discount:data.max_discount||null, valid_until:data.valid_until||null, terms_url:data.terms_url||null, source_url:data.source_url||null, applies_to:data.applies_to||null });
      return db.prepare('SELECT * FROM ml_coupons WHERE id = ?').get(r.lastInsertRowid);
    } catch(e){ return null; }
  },
  toggle(id, active) { try { db.prepare('UPDATE ml_coupons SET active=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(active?1:0,id); } catch(e){} },
  setAutoPublish(id, v) { try { db.prepare('UPDATE ml_coupons SET auto_publish=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(v?1:0,id); } catch(e){} },
  markPublished(id) {
    try { db.prepare("UPDATE ml_coupons SET last_published_at=datetime('now','localtime'), queued_at=NULL WHERE id=?").run(id); } catch(e){}
  },
  markQueued(ids) {
    const list = (ids || []).map(Number).filter(Boolean);
    if (!list.length) return;
    const placeholders = list.map(() => '?').join(',');
    try { db.prepare(`UPDATE ml_coupons SET queued_at=datetime('now','localtime') WHERE id IN (${placeholders})`).run(...list); } catch(e){}
  },
  releaseQueued(ids) {
    const list = (ids || []).map(Number).filter(Boolean);
    if (!list.length) return;
    const placeholders = list.map(() => '?').join(',');
    try { db.prepare(`UPDATE ml_coupons SET queued_at=NULL WHERE id IN (${placeholders})`).run(...list); } catch(e){}
  },
  /** Cupons ativos que batem com um esgotado da fonte, pelo código ou pelo título. */
  findActiveMatching({ code, title }) {
    try {
      if (code) return db.prepare('SELECT * FROM ml_coupons WHERE active = 1 AND UPPER(code) = UPPER(?)').get(code) || null;
      if (title) {
        // Títulos se repetem entre cupons; sem código, só marca quando não há dúvida.
        const rows = db.prepare('SELECT * FROM ml_coupons WHERE active = 1 AND title = ?').all(title);
        return rows.length === 1 ? rows[0] : null;
      }
    } catch (e) {}
    return null;
  },
  markExhausted(id) {
    try {
      db.prepare(`UPDATE ml_coupons SET active=0, queued_at=NULL, exhausted_at=datetime('now','localtime'),
        updated_at=datetime('now','localtime') WHERE id=?`).run(id);
    } catch (e) {}
  },
  /** Esgotados que já tinham sido divulgados e ainda não tiveram o aviso enviado. */
  pendingExhaustNotices(sinceHours = 12) {
    try {
      return db.prepare(`SELECT * FROM ml_coupons
        WHERE active = 0 AND exhausted_at IS NOT NULL AND exhausted_notified_at IS NULL
          AND last_published_at IS NOT NULL
          AND exhausted_at >= datetime('now','localtime', ?)
        ORDER BY exhausted_at`).all(`-${Number(sinceHours) || 12} hours`);
    } catch (e) { return []; }
  },
  markExhaustNotified(ids) {
    const list = (ids || []).map(Number).filter(Boolean);
    if (!list.length) return;
    const placeholders = list.map(() => '?').join(',');
    try { db.prepare(`UPDATE ml_coupons SET exhausted_notified_at=datetime('now','localtime') WHERE id IN (${placeholders})`).run(...list); } catch (e) {}
  },
  removeOlderThanToday() {
    return db.prepare("DELETE FROM ml_coupons WHERE created_at < date('now','localtime','start of day')").run().changes;
  },
  logPublish({ ml_coupon_id, group_ids, message, status, report_json }) {
    try { db.prepare('INSERT INTO ml_coupon_publish_logs (ml_coupon_id, group_ids, message, status, report_json) VALUES (?,?,?,?,?)').run(ml_coupon_id, JSON.stringify(group_ids||[]), message, status, report_json||null); } catch(e){}
  },
};

module.exports = MLCoupon;
