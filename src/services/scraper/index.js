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
  timeout: 15000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Accept': 'text/html,application/xhtml+xml',
  },
});

async function scrapeProduct(url) {
  const response = await http.get(url);
  const finalUrl = response.request?.res?.responseUrl || url;
  const store = detectStore(finalUrl) !== 'generic' ? detectStore(finalUrl) : detectStore(url);
  const $ = cheerio.load(response.data);
  const parser = PARSERS[store] || parseGeneric;
  const data = parser($, finalUrl, response.data);

  console.log(`[Scraper] ${store}: sku=${data.sku} título="${data.title}" preço=${data.price} original=${data.original_price}`);

  return { ...data, store, final_url: finalUrl, url };
}

module.exports = { scrapeProduct };
