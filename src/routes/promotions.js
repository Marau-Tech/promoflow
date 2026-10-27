const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/promotionController');

pages.get('/', c.index);
api.post('/generate', c.generate);
api.put('/:id', c.update);
api.post('/:id/send', c.send);

module.exports = { pages, api };
