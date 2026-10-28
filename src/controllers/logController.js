const Log = require('../models/Log');

exports.index = (req, res) => {
  const status = ['sent', 'failed'].includes(req.query.status) ? req.query.status : null;
  res.render('logs/index', {
    title: 'Logs',
    logs: Log.all(status),
    status,
  });
};
