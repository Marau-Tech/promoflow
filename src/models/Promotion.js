const { db } = require('../config/database');

const Promotion = {
  find(id) { return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id); },
  recent(limit = 20) { return db.prepare('SELECT * FROM promotions ORDER BY created_at DESC LIMIT ?').all(limit); },
  create(data) {
    const r = db.prepare(`
      INSERT INTO promotions (url, final_url, store, sku, title, original_price, price, currency, image_url, coupon_id, slogan_id, template_id, message)
      VALUES (@url, @final_url, @store, @sku, @title, @original_price, @price, @currency, @image_url, @coupon_id, @slogan_id, @template_id, @message)
    `).run({
      url: data.url, final_url: data.final_url || null, store: data.store || null, sku: data.sku || null,
      title: data.title || null, original_price: data.original_price ?? null, price: data.price ?? null,
      currency: data.currency || 'BRL', image_url: data.image_url || null,
      coupon_id: data.coupon_id || null, slogan_id: data.slogan_id || null, template_id: data.template_id || null,
      message: data.message || null,
    });
    return this.find(r.lastInsertRowid);
  },
  update(id, data) {
    db.prepare(`
      UPDATE promotions SET sku=@sku, title=@title, original_price=@original_price, price=@price, currency=@currency,
        image_url=@image_url, coupon_id=@coupon_id, slogan_id=@slogan_id, template_id=@template_id, url=@url, message=@message
      WHERE id=@id
    `).run({
      id, sku: data.sku || null, title: data.title || null, original_price: data.original_price ?? null, price: data.price ?? null,
      currency: data.currency || 'BRL', image_url: data.image_url || null, coupon_id: data.coupon_id || null,
      slogan_id: data.slogan_id || null, template_id: data.template_id || null, url: data.url, message: data.message || null,
    });
    return this.find(id);
  },
  logSend({ promotion_id, group_id, status, error }) {
    db.prepare('INSERT INTO promotion_sends (promotion_id, group_id, status, error) VALUES (?, ?, ?, ?)')
      .run(promotion_id, group_id, status, error || null);
  },
  sendsOf(promotionId) {
    return db.prepare(`
      SELECT s.*, g.name AS group_name, g.platform FROM promotion_sends s
      JOIN groups g ON g.id = s.group_id WHERE s.promotion_id = ? ORDER BY s.sent_at DESC
    `).all(promotionId);
  },
};

module.exports = Promotion;
