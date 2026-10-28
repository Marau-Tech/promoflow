const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/scheduleController');

pages.get('/', c.index);
pages.post('/cancel-all', c.cancelAll);
pages.post('/delete-all', c.removeAll);
pages.post('/cupons/:id/cancel', c.cancelCouponBatch);
pages.post('/cupons/:id/delete', c.removeCouponBatch);
pages.post('/:id/cancel', c.cancel);
pages.post('/:id/delete', c.remove);
api.post('/', c.create);
api.post('/batch', c.createBatch);

module.exports = { pages, api };