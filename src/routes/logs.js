const router = require('express').Router();
const ctrl = require('../controllers/logController');

router.get('/', ctrl.index);
router.get('/export.csv', ctrl.exportCsv);
router.post('/clear', ctrl.clear);

module.exports = router;
