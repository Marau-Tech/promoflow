const router = require('express').Router();

router.get('/', require('../controllers/dashboardController').index);
router.use('/promocoes', require('./promotions').pages);
router.use('/api/promotions', require('./promotions').api);
router.use('/cupons', require('./coupons'));
router.use('/cupons/ml', require('./mlCoupons').pages);
router.use('/api/cupons/ml', require('./mlCoupons').api);
router.use('/templates', require('./templates').pages);
router.use('/api/templates', require('./templates').api);
router.use('/slogans', require('./slogans'));
router.use('/grupos', require('./groups').pages);
router.use('/api/groups', require('./groups').api);
router.use('/agendamentos', require('./schedules').pages);
router.use('/api/schedules', require('./schedules').api);
router.use('/descobrir', require('./autoDiscovery').pages);
router.use('/api/descobrir', require('./autoDiscovery').api);
router.use('/ml', require('./mlAuth'));
router.use('/logs', require('./logs'));

module.exports = router;
