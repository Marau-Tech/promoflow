const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/autoDiscoveryController');

pages.get('/', c.index);
pages.post('/resend', c.resendForm);
api.get('/config', c.getConfig);
api.post('/config', c.saveConfig);
api.post('/run', c.run);
api.post('/affiliate/test', c.testAffiliate);
api.post('/resend', c.resend);
api.get('/runs', c.runs);
api.get('/candidates', c.candidates);

module.exports = { pages, api };
