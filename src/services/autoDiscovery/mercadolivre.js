const axios = require('axios');
const cheerio = require('cheerio');
const { scrapeProduct } = require('../scraper');
const { detectStore } = require('../scraper/storeDetector');

const http = axios.create({
  timeout: 25000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  },
  validateStatus: s => s >= 200 && s < 400,
});

const CATEGORIES = (process.env.ML_DISCOVERY_CATEGORIES || 'MLB1648,MLB1051,MLB1144,MLB1276,MLB1430,MLB1747,MLB1367,MLB1132')
  .split(',').map(s => s.trim()).filter(Boolean);

const mlAuth = require('../mlAuth');
const logger = require('../logger');

async function getToken() {
  try {
    return (await mlAuth.getAccessToken()) || '';
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao obter token da API', logger.errorMeta(e), 'auto_discovery');
    return '';
  }
}

function isBotPage(html = '') {
  return /account-verification|suspicious-traffic/i.test(String(html));
}

function mapLimit(list, limit, fn) {
  return new Promise((resolve) => {
    const results = new Array(list.length);
    let next = 0, active = 0, done = 0;
    if (!list.length) return resolve(results);
    const run = () => {
      while (active < limit && next < list.length) {
        const i = next++;
        active++;
        Promise.resolve()
          .then(() => fn(list[i], i))
          .then(r => { results[i] = r; })
          .catch(() => { results[i] = null; })
          .finally(() => {
            active--;
            done++;
            if (done === list.length) resolve(results);
            else run();
          });
      }
    };
    run();
  });
}

async function fetchProduct(token, productId) {
  const headers = { Authorization: `Bearer ${token}` };
  const [detail, items] = await Promise.all([
    axios.get(`https://api.mercadolibre.com/products/${productId}`, { headers, timeout: 20000 }),
    axios.get(`https://api.mercadolibre.com/products/${productId}/items`, {
      params: { limit: 1 },
      headers,
      timeout: 20000,
    }),
  ]);

  const p = detail.data || {};
  const it = items.data?.results?.[0];
  if (!it || !it.price) return null;

  const pic = (p.pictures || [])[0];
  const image = pic?.secure_url || pic?.url || null;
  const url = `https://www.mercadolivre.com.br/p/${productId}`;

  return {
    url,
    final_url: url,
    sku: productId,
    title: p.name || p.family_name || productId,
    price: it.price,
    original_price: it.original_price || null,
    currency: it.currency_id || 'BRL',
    image_url: image,
    store: 'mercadolivre',
    sold_quantity: it.sold_quantity || null,
    is_most_sold: true,
    has_extra_gain: false,
  };
}

async function fetchViaApi(token, opts = {}) {
  const items = [];
  let authError = null;
  let categorySuccess = 0;
  const seenIds = new Set();
  const skipped = { known: 0, forbidden: 0, notFound: 0, other: 0 };

  for (const category of CATEGORIES) {
    let ids = [];
    try {
      const res = await axios.get(`https://api.mercadolibre.com/highlights/MLB/category/${category}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });
      categorySuccess++;
      const content = res.data?.content || [];
      ids = content
        .map(x => x?.id)
        .filter(Boolean)
        .filter(id => {
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          if (/^MLBU/i.test(id)) return false;
          if (opts.isKnown && opts.isKnown(id)) {
            skipped.known++;
            return false;
          }
          return true;
        })
        .slice(0, 8);
    } catch (e) {
      const status = e.response?.status;
      logger.once(`ml-highlights-${category}-${status || e.code || 'err'}`, 300000, 'warn', 'mercadolivre',
        'Falha ao buscar destaques do Mercado Livre',
        logger.errorMeta(e, { category_id: category, status }), 'auto_discovery');
      if (status === 401 || status === 403) authError = status;
      continue;
    }

    const found = await mapLimit(ids, 4, async (id) => {
      try {
          return await fetchProduct(token, id);
      } catch (e) {
        const status = e.response?.status;
        if (status === 401) {
          authError = status;
          skipped.forbidden++;
        } else if (status === 403) {
          skipped.forbidden++;
        } else if (status === 404) {
          skipped.notFound++;
        } else {
          skipped.other++;
          logger.once(`ml-product-${status || e.code || 'err'}`, 300000, 'warn', 'mercadolivre',
            'Falha ao buscar detalhes de produto',
            logger.errorMeta(e, { product_id: id, status }), 'auto_discovery');
        }
        return null;
      }
    });

    found.filter(Boolean).forEach(x => items.push(x));
  }

  if (skipped.forbidden || skipped.notFound || skipped.other || skipped.known) {
    logger.info('mercadolivre', 'Produtos ignorados durante a descoberta', {
      ...skipped,
      categories: CATEGORIES.length,
    }, 'auto_discovery');
  }

  if (!items.length && !categorySuccess) {
    if (authError) {
      throw new Error('A API do Mercado Livre recusou as requisições (401/403). Reconecte a conta em /descobrir ou verifique as permissões do app.');
    }
    throw new Error('Não foi possível consultar a API do Mercado Livre. Tente novamente em instantes.');
  }

  return items;
}

function extractLinks($) {
  const links = new Set();
  $('a[href*="/MLB"]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('//')) href = 'https:' + href;
    if (href.startsWith('/')) href = 'https://www.mercadolivre.com.br' + href;
    if (!href.includes('mercadolivre.com.br')) return;
    if (href.includes('/p/MLB') || href.includes('-MLB')) {
      links.add(href.split('?')[0].split('#')[0]);
    }
  });
  return Array.from(links);
}

async function fetchViaScraping() {
  const links = new Set();
  let blocked = 0;
  let requests = 0;

  for (const category of CATEGORIES) {
    requests++;
    try {
      const res = await http.get(`https://www.mercadolivre.com.br/mais-vendidos/${category}`);
      if (isBotPage(res.data)) { blocked++; continue; }
      const $ = cheerio.load(res.data || '');
      extractLinks($).forEach(l => links.add(l));
    } catch (e) {
      logger.once(`ml-scrape-${category}-${e.code || 'err'}`, 300000, 'warn', 'mercadolivre',
        'Falha ao buscar mais vendidos por scraping',
        logger.errorMeta(e, { category_id: category }), 'auto_discovery');
    }
  }

  if (requests > 0 && blocked === requests) {
    throw new Error(
      'O Mercado Livre está bloqueando as requisições automáticas (verificação anti-bot). ' +
      'Conecte sua conta do Mercado Livre em /descobrir (botão "Conectar Mercado Livre") para usar a API oficial.'
    );
  }

  const items = [];
  for (const url of Array.from(links).slice(0, 60)) {
    try {
      const data = await scrapeProduct(url);
      const title = String(data?.title || '');
      const looksBlocked = !title || /^(mercado livre|mercado libre)$/i.test(title.trim()) || (!data.price && !data.original_price);
      if (looksBlocked) continue;
      items.push({
        ...data,
        store: 'mercadolivre',
        is_most_sold: true,
      });
    } catch (e) {
      logger.once(`ml-scrape-product-${e.code || 'err'}`, 300000, 'warn', 'mercadolivre',
        'Falha ao analisar produto via scraping',
        logger.errorMeta(e, { url }), 'auto_discovery');
    }
  }
  return items;
}

async function discover(opts = {}) {
  const token = await getToken();
  if (token) return fetchViaApi(token, opts);
  return fetchViaScraping();
}

async function fetchMostSold() {
  const items = await discover();
  return items.map(i => i.final_url || i.url).filter(Boolean);
}

module.exports = { discover, fetchMostSold };
