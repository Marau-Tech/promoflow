const STORES = [
  { key: 'mercadolivre', label: 'Mercado Livre',  pattern: /mercadolivre\.com|mercadolibre\.com|meli\.la|mlb\./i },
  { key: 'shopee',       label: 'Shopee',         pattern: /shopee\.com|shope\.ee|s\.shopee/i },
  { key: 'amazon',       label: 'Amazon',         pattern: /amazon\.com|amzn\.to|a\.co/i },
  { key: 'aliexpress',   label: 'AliExpress',     pattern: /aliexpress\.com|s\.click\.aliexpress|a\.aliexpress/i },
  { key: 'shein',        label: 'Shein',          pattern: /shein\.com|onelink\.shein|us\.shein/i },
  { key: 'magalu',       label: 'Magazine Luiza', pattern: /magazineluiza\.com|magazinevoce\.com|magalu/i },
  { key: 'casasbahia',   label: 'Casas Bahia',    pattern: /casasbahia\.com/i },
  { key: 'kabum',        label: 'KaBuM!',         pattern: /kabum\.com/i },
  { key: 'natura',       label: 'Natura',         pattern: /natura\.com/i },
  { key: 'tiktokshop',   label: 'TikTok Shop',   pattern: /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktokshop\.com/i },
];

function detectStore(url = '') {
  const found = STORES.find(s => s.pattern.test(url));
  return found ? found.key : 'generic';
}

function storeLabel(key) {
  return STORES.find(s => s.key === key)?.label || 'Outra loja';
}

module.exports = { STORES, detectStore, storeLabel };
