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

  let title = product?.name
    || $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content')
    || $('h1').first().text()
    || $('title').first().text();

  let image = (Array.isArray(product?.image) ? product.image[0] : product?.image)
    || $('meta[property="og:image"]').attr('content')
    || $('meta[property="og:image:secure_url"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || $('meta[itemprop="image"]').attr('content');

  if (typeof image === 'object' && image?.url) image = image.url;

  if (finalUrl) {
    try {
      const u = new URL(finalUrl);
      const og = u.searchParams.get('og_info') || u.searchParams.get('share_params') || u.searchParams.get('shareInfo');
      if (og) {
        let decoded = og;
        for (let i = 0; i < 15; i++) {
          try { const d = decodeURIComponent(decoded); if (d === decoded) break; decoded = d; } catch (_) { break; }
        }
        decoded = String(decoded).replace(/\+/g, ' ');
        if (decoded.startsWith('{')) {
          try {
            const j = JSON.parse(decoded);
            if (j.title) title = String(j.title).replace(/\+/g, ' ');
            if (j.image) image = j.image;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  if (finalUrl) {
    try {
      const u = new URL(finalUrl);
      const og = u.searchParams.get('og_info');
      if (og) {
        let decoded = og;
        try { decoded = decodeURIComponent(decoded); } catch (_) {}
        try { if (/%[0-9A-Fa-f]{2}/.test(decoded)) decoded = decodeURIComponent(decoded); } catch (_) {}
        try { decoded = decoded.replace(/\+/g, ' '); } catch (_) {}
        try {
          const j = JSON.parse(decoded);
          if (j.title) title = j.title.replace(/\+/g, ' ');
          if (j.image) image = j.image;
        } catch (_) {}
      }
    } catch (_) {}
  }

  let price = parseNumber(offer?.price || offer?.lowPrice || offer?.priceSpecification?.price)
    || parseNumber($('meta[property="product:price:amount"]').attr('content'))
    || parseNumber($('meta[property="og:price:amount"]').attr('content'))
    || parseNumber($('[itemprop="price"]').attr('content'))
    || parseNumber($('[data-price]').first().attr('data-price'))
    || parseNumber($('.price, .product-price, .sale-price, [class*="price"]').first().text());

  let original_price = parseNumber(offer?.highPrice || product?.offers?.[0]?.priceSpecification?.price)
    || parseNumber($('meta[property="product:original_price:amount"]').attr('content'))
    || parseNumber($('meta[property="og:price:standard_amount"]').attr('content'))
    || parseNumber($('.old-price, .original-price, .list-price, [class*="original"], [class*="old"]').first().text());

  if (original_price && price && original_price <= price) original_price = null;

  const currency = offer?.priceCurrency
    || $('meta[property="product:price:currency"]').attr('content')
    || $('meta[property="og:price:currency"]').attr('content')
    || 'BRL';

  return { title: (title || '').replace(/\s+/g, ' ').trim(), image_url: image || null, price, original_price, currency, sku: product?.sku || null };
}

module.exports = { parseGeneric, parseNumber };
