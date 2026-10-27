function parseNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const s = String(value).replace(/[^\d,.]/g, '');
  if (!s) return null;
  const normalized = s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/,/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function findProductInJsonLd($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text());
      const nodes = Array.isArray(json) ? json : (json['@graph'] || [json]);
      nodes.forEach(n => {
        const type = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
        if (type.includes('Product')) products.push(n);
      });
    } catch (_) { /* ignora JSON inválido */ }
  });
  return products[0] || null;
}

function parseGeneric($, finalUrl) {
  const product = findProductInJsonLd($);
  const offer = product?.offers ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) : null;

  const title = product?.name || $('meta[property="og:title"]').attr('content') || $('title').first().text();
  const image = (Array.isArray(product?.image) ? product.image[0] : product?.image) || $('meta[property="og:image"]').attr('content');
  const price = parseNumber(offer?.price || offer?.lowPrice)
    || parseNumber($('meta[property="product:price:amount"]').attr('content'))
    || parseNumber($('[itemprop="price"]').attr('content'));
  const currency = offer?.priceCurrency || $('meta[property="product:price:currency"]').attr('content') || 'BRL';

  return { title: (title || '').trim(), image_url: image || null, price, original_price: null, currency, sku: product?.sku || null };
}

module.exports = { parseGeneric, parseNumber };
