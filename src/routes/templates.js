const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/templateController');

pages.get('/', c.index);
pages.post('/', c.create);
pages.post('/:id', c.update);
pages.post('/:id/default', c.setDefault);
pages.post('/:id/delete', c.remove);
api.post('/preview', c.preview);

module.exports = { pages, api };
