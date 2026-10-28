const { db } = require('../config/database');

const Coupon = {
  all() { return db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all(); },
  find(id) { return db.prepare('SELECT * FROM coupons WHERE id = ?').get(id); },
  activeByPlatform(platform) {
    return db.prepare(`SELECT * FROM coupons WHERE active = 1 AND (platform = ? OR platform = 'all') ORDER BY code`).all(platform);
  },
  count() { return db.prepare('SELECT COUNT(*) AS c FROM coupons').get().c; },
  create({ code, platform, discount_type, discount_value, description, valid_until }) {
    const r = db.prepare(`INSERT INTO coupons (code, platform, discount_type, discount_value, description, valid_until) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(code.trim().toUpperCase(), platform, discount_type, Number(discount_value) || 0, description || null, valid_until || null);
    return this.find(r.lastInsertRowid);
  },
  update(id, { code, platform, discount_type, discount_value, description, active, valid_until }) {
    db.prepare(`UPDATE coupons SET code=?, platform=?, discount_type=?, discount_value=?, description=?, active=?, valid_until=? WHERE id=?`)
      .run(code.trim().toUpperCase(), platform, discount_type, Number(discount_value) || 0, description || null, active ? 1 : 0, valid_until || null, id);
    return this.find(id);
  },
  remove(id) { db.prepare('DELETE FROM coupons WHERE id = ?').run(id); },
  label(coupon) {
    if (!coupon) return '';
    return coupon.discount_type === 'percent'
      ? `${coupon.discount_value}% OFF`
      : `R$ ${Number(coupon.discount_value).toFixed(2).replace('.', ',')} OFF`;
  },
};

module.exports = Coupon;
