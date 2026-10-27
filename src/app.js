const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const morgan = require('morgan');
const routes = require('./routes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use(routes);

app.use((req, res) => res.status(404).render('error', { title: 'Página não encontrada', message: 'A página solicitada não existe.' }));

app.use((err, req, res, next) => {
  console.error(err);
  const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api');
  if (wantsJson) return res.status(err.status || 500).json({ error: err.message || 'Erro interno' });
  res.status(err.status || 500).render('error', { title: 'Erro', message: err.message });
});

module.exports = app;
