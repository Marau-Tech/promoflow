const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/groupController');

pages.get('/', c.index);
pages.post('/whatsapp/sync', c.syncWhatsapp);
pages.post('/whatsapp/logout', c.logoutWhatsapp);
pages.post('/telegram/sync', c.syncTelegram);
pages.post('/telegram/manual', c.addTelegramManual);
pages.post('/delete-selected', c.removeMany);
pages.post('/:id/toggle', c.toggle);
pages.post('/:id/delete', c.remove);
api.get('/whatsapp/status', c.whatsappStatus);

module.exports = { pages, api };
