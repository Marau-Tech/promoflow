const axios = require('axios');
const cheerio = require('cheerio');
const { detectStore } = require('./storeDetector');
const { parseGeneric } = require('./parsers/generic');
const { parseMercadoLivre } = require('./parsers/mercadoLivre');

const PARSERS = {
  mercadolivre: parseMercadoLivre,
  // Para adicionar uma loja: crie parsers/<loja>.js e registre aqui.
};

const http = axios.create({
  timeout: 20000,
  maxRedirects: 15,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
  validateStatus: s => s >= 200 && s < 400,
});

async function scrapeProduct(url) {
  try {
    const response = await http.get(url);
    let finalUrl = response.request?.res?.responseUrl || response.headers?.location || url;
    if (finalUrl && typeof finalUrl === 'object' && finalUrl.href) finalUrl = finalUrl.href;

    if (finalUrl) {
      try {
        const u = new URL(finalUrl);
        const og = u.searchParams.get('og_info');
        if (og) {
          let decoded = og;
          for (let i = 0; i < 12; i++) {
            try { const d = decodeURIComponent(decoded); if (d === decoded) break; decoded = d; } catch (_) { break; }
          }
          decoded = decoded.split('+').join(' ');
          try {
            // handle already decoded
            if (decoded.startsWith('{')) {
              const j = JSON.parse(decoded);
              if (j.title || j.image) {
                const store2 = detectStore(finalUrl) !== 'generic' ? detectStore(finalUrl) : (detectStore(url) || 'tiktokshop');
                console.log('[Scraper] tiktokshop from og_info');
                return {
                  title: String(j.title || '').replace(/\+/g, ' ').trim(),
                  image_url: j.image || null,
                  price: null,
                  original_price: null,
                  currency: 'BRL',
                  sku: null,
                  store: store2,
                  final_url: finalUrl,
                  url,
                };
              }
            }
          } catch (_) {}
          try {
            // try again
            decoded = decodeURIComponent(decoded.replace(/%2B/g, '+'));
            decoded = decoded.replace(/\+/g, ' ');
            const j = JSON.parse(decoded);
            if (j.title || j.image) {
              const store2 = detectStore(finalUrl) !== 'generic' ? detectStore(finalUrl) : (detectStore(url) || 'tiktokshop');
              console.log('[Scraper] tiktokshop from og_info');
              return {
                title: String(j.title || '').replace(/\+/g, ' ').trim(),
                image_url: j.image || null,
                price: j.price ? (typeof j.price === 'number' ? j.price : parseFloat(String(j.price).replace(/[^0-9,.]/g,'').replace(',','.'))) : null,
                original_price: j.original_price || j.old_price || null,
                currency: j.currency || 'BRL',
                sku: j.sku || null,
                store: store2,
                final_url: finalUrl,
                url,
              };
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    const store = detectStore(finalUrl) !== 'generic' ? detectStore(finalUrl) : detectStore(url);
    const $ = cheerio.load(response.data || '');
    const parser = PARSERS[store] || parseGeneric;
    const data = parser($, finalUrl, response.data);

    console.log(`[Scraper] ${store}: sku=${data.sku} título="${data.title}" preço=${data.price} original=${data.original_price}`);

    return { ...data, store, final_url: finalUrl, url };
  } catch (err) {
    if (err.response?.headers?.location) {
      const loc = err.response.headers.location;
      const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
      try {
        const u = new URL(next);
        const og = u.searchParams.get('og_info');
        if (og) {
          let decoded = og;
          for (let i = 0; i < 6; i++) {
            try { const d = decodeURIComponent(decoded); if (d === decoded) break; decoded = d; } catch (_) { break; }
          }
          decoded = decoded.replace(/\+/g, ' ');
          try {
            const j = JSON.parse(decoded);
            if (j.title || j.image) {
              return {
                title: (j.title || '').replace(/\+/g, ' ').trim(),
                image_url: j.image || null,
                price: null,
                original_price: null,
                currency: 'BRL',
                sku: null,
                store: 'tiktokshop',
                final_url: next,
                url,
              };
            }
          } catch (_) {}
        }
      } catch (_) {}
      return scrapeProduct(next);
    }
    throw err;
  }
}

module.exports = { scrapeProduct };
