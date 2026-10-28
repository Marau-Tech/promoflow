const { db } = require('../config/database');

const Log = {
  all(status = null, limit = 200) {
    let sql = `
      SELECT ps.*, p.title AS promo_title, g.name AS group_name, g.platform
      FROM promotion_sends ps
      LEFT JOIN promotions p ON p.id = ps.promotion_id
      LEFT JOIN groups g ON g.id = ps.group_id
    `;
    if (status) sql += ' WHERE ps.status = ?';
    sql += ' ORDER BY ps.sent_at DESC LIMIT ?';
    return status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit);
  },
};

module.exports = Log;
