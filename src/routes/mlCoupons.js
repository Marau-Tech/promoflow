const pages = require('express').Router();
const api = require('express').Router();
const c = require('../controllers/mlCouponController');

pages.get('/', c.index);
api.post('/discover', c.discover);
api.post('/publish/:id', c.publish);
api.post('/publish-selected', c.publishSelected);
api.post('/publish-all', c.publishAll);
api.post('/config', c.saveConfig);
api.post('/toggle/:id', c.toggle);
api.post('/autopublish/:id', c.toggleAutoPublish);

module.exports = { pages, api };
