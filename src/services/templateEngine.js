const Mustache = require('mustache');
const Coupon = require('../models/Coupon');

Mustache.escape = text => text;

function money(value) {
  if (value == null || value === '') return '';
  return Number(value).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildContext({ promotion, coupon, slogan, storeLabel }) {
  const discount = promotion.original_price && promotion.price && promotion.original_price > promotion.price
    ? Math.round((1 - promotion.price / promotion.original_price) * 100)
    : null;

  return {
    title: promotion.title || '',
    price: money(promotion.price),
    original_price: promotion.original_price ? money(promotion.original_price) : '',
    url: promotion.url,
    store: storeLabel || promotion.store || '',
    sku: promotion.sku || '',
    slogan: slogan?.text || '',
    discount_percent: discount,
    coupon: coupon ? { code: coupon.code, label: Coupon.label(coupon), description: coupon.description || '' } : null,
  };
}

function render(templateContent, context) {
  return Mustache.render(templateContent, context).replace(/\n{3,}/g, '\n\n').trim();
}

function toTelegramHtml(text) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text)
    .replace(/\*(.+?)\*/g, '<b>$1</b>')
    .replace(/~(.+?)~/g, '<s>$1</s>')
    .replace(/_(.+?)_/g, '<i>$1</i>');
}

module.exports = { buildContext, render, money, toTelegramHtml };
