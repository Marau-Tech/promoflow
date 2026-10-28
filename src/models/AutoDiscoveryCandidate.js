const { db } = require('../config/database');

const AutoDiscoveryCandidate = {
  upsert(data) {
    const key = data.sku || data.url;
    if (!key) return null;
    try {
      return db.prepare(`
        INSERT INTO auto_discovery_candidates (run_id, store, url, final_url, sku, title, price, original_price, discount_percent, image_url, is_most_sold, has_extra_gain, extra_gain_text, score, reason, key)
        VALUES (@run_id, @store, @url, @final_url, @sku, @title, @price, @original_price, @discount_percent, @image_url, @is_most_sold, @has_extra_gain, @extra_gain_text, @score, @reason, @key)
        ON CONFLICT(key) DO UPDATE SET
          price = excluded.price,
          original_price = excluded.original_price,
          discount_percent = excluded.discount_percent,
          title = excluded.title,
          image_url = excluded.image_url,
          is_most_sold = MAX(auto_discovery_candidates.is_most_sold, excluded.is_most_sold),
          has_extra_gain = MAX(auto_discovery_candidates.has_extra_gain, excluded.has_extra_gain),
          extra_gain_text = COALESCE(excluded.extra_gain_text, auto_discovery_candidates.extra_gain_text),
          score = MAX(auto_discovery_candidates.score, excluded.score),
          run_id = COALESCE(excluded.run_id, auto_discovery_candidates.run_id)
        RETURNING *
      `).get({
        run_id: data.run_id || null,
        store: data.store || 'mercadolivre',
        url: data.url,
        final_url: data.final_url || data.url,
        sku: data.sku || null,
        title: data.title || null,
        price: data.price ?? null,
        original_price: data.original_price ?? null,
        discount_percent: data.discount_percent ?? null,
        image_url: data.image_url || null,
        is_most_sold: data.is_most_sold ? 1 : 0,
        has_extra_gain: data.has_extra_gain ? 1 : 0,
        extra_gain_text: data.extra_gain_text || null,
        score: data.score || 0,
        reason: data.reason || null,
        key,
      });
    } catch (e) {
      console.error('[AutoDiscoveryCandidate] upsert:', e.message);
      return db.prepare('SELECT * FROM auto_discovery_candidates WHERE key = ?').get(key);
    }
  },
  getNew(limit = 50) {
    return db.prepare(`SELECT * FROM auto_discovery_candidates
      WHERE status = 'new'
      ORDER BY score DESC, discount_percent DESC, seen_at ASC
      LIMIT ?`).all(limit);
  },
  markGenerated(ids, promotionId) {
    if (!ids?.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE auto_discovery_candidates SET status = 'generated', promotion_id = ? WHERE id IN (${placeholders})`).run(promotionId, ...ids);
  },
  markSent(ids) {
    if (!ids?.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE auto_discovery_candidates SET status = 'sent' WHERE id IN (${placeholders})`).run(...ids);
  },
  markSkipped(ids, reason = 'skipped') {
    if (!ids?.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE auto_discovery_candidates SET status = 'skipped', reason = ? WHERE id IN (${placeholders})`).run(reason, ...ids);
  },
  alreadyExists({ sku, url, store = 'mercadolivre' }) {
    if (sku) {
      const p = db.prepare('SELECT id FROM promotions WHERE store = ? AND sku = ?').get(store, sku);
      if (p) return true;
    }
    if (url) {
      const p = db.prepare('SELECT id FROM promotions WHERE url = ? OR final_url = ?').get(url, url);
      if (p) return true;
    }
    const key = sku || url;
    if (!key) return false;
    const c = db.prepare(`SELECT id FROM auto_discovery_candidates WHERE key = ? AND status IN ('generated','sent')`).get(key);
    return !!c;
  },
  list(limit = 100) {
    return db.prepare('SELECT * FROM auto_discovery_candidates ORDER BY seen_at DESC LIMIT ?').all(limit);
  },
};

module.exports = AutoDiscoveryCandidate;
