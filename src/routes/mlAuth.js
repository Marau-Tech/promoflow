const router = require('express').Router();
const c = require('../controllers/mlAuthController');

router.get('/connect', c.connect);
router.get('/callback', c.callback);
router.post('/disconnect', c.disconnect);
router.get('/status', c.status);

module.exports = router;
