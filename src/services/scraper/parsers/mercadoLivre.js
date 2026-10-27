const { parseGeneric, parseNumber } = require('./generic');

function parseMercadoLivre($, finalUrl) {
  const base = parseGeneric($, finalUrl);

  const skuMatch = finalUrl.match(/MLB-?(\d+)/i);
  const sku = skuMatch ? `MLB${skuMatch[1]}` : base.sku;

  const priceBlock = $('.ui-pdp-price__second-line .andes-money-amount').first();
  const fraction = priceBlock.find('.andes-money-amount__fraction').first().text();
  const cents = priceBlock.find('.andes-money-amount__cents').first().text();
  const price = fraction ? parseNumber(`${fraction},${cents || '00'}`) : base.price;

  const prev = $('.andes-money-amount--previous').first();
  const prevFraction = prev.find('.andes-money-amount__fraction').first().text();
  const prevCents = prev.find('.andes-money-amount__cents').first().text();
  const original_price = prevFraction ? parseNumber(`${prevFraction},${prevCents || '00'}`) : null;

  const title = $('.ui-pdp-title').first().text().trim() || base.title;
  const image = $('.ui-pdp-gallery__figure img').first().attr('data-zoom')
    || $('.ui-pdp-gallery__figure img').first().attr('src')
    || base.image_url;

  return { ...base, sku, title, price, original_price, image_url: image };
}

module.exports = { parseMercadoLivre };
