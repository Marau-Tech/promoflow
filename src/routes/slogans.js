const router = require('express').Router();
const c = require('../controllers/sloganController');

router.post('/', c.create);
router.post('/:id', c.update);
router.post('/:id/delete', c.remove);

module.exports = router;
