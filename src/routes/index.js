const router = require('express').Router();

router.get('/', (req, res) => res.redirect('/promocoes'));
router.use('/promocoes', require('./promotions').pages);
router.use('/api/promotions', require('./promotions').api);
router.use('/cupons', require('./coupons'));
router.use('/templates', require('./templates').pages);
router.use('/api/templates', require('./templates').api);
router.use('/slogans', require('./slogans'));
router.use('/grupos', require('./groups').pages);
router.use('/api/groups', require('./groups').api);
router.use('/agendamentos', require('./schedules').pages);
router.use('/api/schedules', require('./schedules').api);
router.use('/logs', require('./logs'));

module.exports = router;
