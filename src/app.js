const fs = require('fs');
const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const morgan = require('morgan');
const routes = require('./routes');
const logger = require('./services/logger');
const SystemLog = require('./models/SystemLog');

const app = express();

function assetVersion(relPath) {
  try {
    return Math.floor(fs.statSync(path.join(__dirname, 'public', relPath)).mtimeMs).toString(36);
  } catch (e) {
    return '1';
  }
}

const ASSET_VERSIONS = {
  css: assetVersion('css/style.css'),
  js: assetVersion('js/ui-dialogs.js'),
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.assetVersion = ASSET_VERSIONS;
  try {
    const stats = SystemLog.stats();
    res.locals.logErrors24h = stats.error || 0;
  } catch (e) {
    res.locals.logErrors24h = 0;
  }
  next();
});

app.use((req, res, next) => {
  const requestPath = req.path;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && body.error) {
      res.locals.__errorMessage = String(body.error);
    }
    return sendJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode < 400 || res.locals.__errorLogged) return;
    const level = res.statusCode >= 500 ? 'error' : 'warn';
    const message = res.locals.__errorMessage || `Requisição falhou com status ${res.statusCode}`;
    logger.once(
      `http-${res.statusCode}-${req.method}-${requestPath}`,
      5000,
      level,
      categoryForPath(requestPath),
      message,
      { status: res.statusCode, method: req.method, path: req.originalUrl, error: res.locals.__errorMessage },
      'http'
    );
  });
  next();
});

app.use(routes);

function categoryForPath(pathname = '') {
  if (pathname.startsWith('/api/cupons/ml') || pathname.startsWith('/cupons/ml')) return 'cupons_ml';
  if (pathname.startsWith('/api/cupons') || pathname.startsWith('/cupons')) return 'cupons';
  if (pathname.startsWith('/api/schedules') || pathname.startsWith('/agendamentos')) return 'agendamentos';
  if (pathname.startsWith('/ml') || pathname.startsWith('/api/descobrir') || pathname.startsWith('/descobrir')) return 'mercadolivre';
  if (pathname.includes('/whatsapp')) return 'whatsapp';
  if (pathname.includes('/telegram')) return 'telegram';
  if (pathname.startsWith('/grupos') || pathname.startsWith('/api/groups')) return 'grupos';
  if (pathname.startsWith('/templates') || pathname.startsWith('/api/templates')) return 'templates';
  if (pathname.startsWith('/slogans')) return 'slogans';
  if (pathname.startsWith('/promocoes') || pathname.startsWith('/api/promotions')) return 'promocoes';
  if (pathname.startsWith('/api')) return 'api';
  return 'sistema';
}

app.use((req, res) => {
  const category = categoryForPath(req.originalUrl.split('?')[0]);
  logger.once(
    `404:${req.method}:${req.path}`,
    60000,
    'warn',
    category,
    'Rota não encontrada',
    { method: req.method, path: req.originalUrl },
    'http'
  );
  res.locals.__errorLogged = true;
  res.status(404).render('error', { title: 'Página não encontrada', message: 'A página solicitada não existe.' });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const category = categoryForPath(req.originalUrl.split('?')[0]);
  if (!res.locals.__errorLogged) {
    logger.error(
      category,
      `${req.method} ${req.originalUrl} — ${err.message || 'Erro interno'}`,
      logger.errorMeta(err, {
        status,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      }),
      'http'
    );
  }
  res.locals.__errorLogged = true;

  const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api');
  if (wantsJson) return res.status(status).json({ error: err.message || 'Erro interno' });
  res.status(status).render('error', { title: 'Erro', message: err.message || 'Erro interno' });
});

module.exports = app;
