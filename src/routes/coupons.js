const router = require('express').Router();
const c = require('../controllers/couponController');

router.get('/', c.index);
router.post('/', c.create);
router.post('/:id', c.update);
router.post('/:id/delete', c.remove);

module.exports = router;
