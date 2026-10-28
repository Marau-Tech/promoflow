const router = require('express').Router();
const ctrl = require('../controllers/logController');
router.get('/', ctrl.index);
module.exports = router;
