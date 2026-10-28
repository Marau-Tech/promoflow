const CATEGORY_KEYWORDS = {
  construcao: [
    'constru', 'construcao', 'obra', 'reforma', 'ferramenta', 'ferramentas',
    'parafusadeira', 'furadeira', 'serra', 'cimento', 'tijolo', 'argamassa',
    'telha', 'tinta', 'porcelanato', 'rejunte', 'cano', 'pvc', 'hidraulica',
    'eletrica', 'lampada', 'tomada', 'disjuntor', 'martelo', 'broca',
    'parafuso', 'prego', 'acabamento',
  ],
  moveis: [
    'movel', 'moveis', 'sofa', 'cama', 'mesa', 'cadeira', 'armario',
    'colchao', 'estante', 'guarda roupa', 'poltrona', 'rack', 'escrivaninha',
    'gaveteiro', 'beliche', 'berco', 'criado mudo', 'apeadeiro',
  ],
  tecnologia: [
    'tecnologia', 'tech', 'celular', 'smartphone', 'notebook', 'computador',
    'monitor', 'teclado', 'mouse', 'headset', 'fone', 'console', 'playstation',
    'xbox', 'nintendo', 'joystick', 'controle', 'video game', 'game', 'tv',
    'tablet', 'smartwatch', 'camera', 'ssd', 'hd', 'memoria', 'processador',
    'placa de video', 'gpu', 'roteador', 'caixa de som', 'alexa', 'echo dot',
    'drone', 'impressora', 'kindle', 'iphone', 'galaxy', 'ipad', 'macbook',
    'dualsense', 'dualshock',
  ],
  beleza: [
    'beleza', 'perfume', 'maquiagem', 'shampoo', 'condicionador', 'creme',
    'skincare', 'cabelo', 'cosmetico', 'hidratante', 'protetor solar', 'isdin',
  ],
  autopecas: [
    'auto partes', 'auto pecas', 'autopecas', 'autopeca', 'peca automotiva',
    'pecas automotivas', 'carro', 'moto', 'pneu', 'oleo', 'farol',
    'retrovisor', 'parachoque', 'freio', 'suspensao', 'volante',
    'tapete automotivo', 'bateria automotiva',
  ],
};

const BRAND_KEYWORDS = {
  samsung: ['samsung', 'galaxy'],
  isdin: ['isdin'],
};

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return Object.values(value).filter(v => typeof v === 'string').join(' ');
}

function detectScope(source) {
  const raw = textOf(source);
  const text = normalize(raw);
  const categories = [];
  const brands = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(normalize(keyword)))) categories.push(category);
  }
  for (const [brand, keywords] of Object.entries(BRAND_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(normalize(keyword)))) brands.push(brand);
  }

  return { categories, brands, text };
}

function couponScope(coupon = {}) {
  return detectScope({
    code: coupon.code,
    title: coupon.title,
    description: coupon.description,
    rules_text: coupon.rules_text,
    applies_to: coupon.applies_to,
  });
}

function promotionScope(promotion = {}) {
  return detectScope({
    title: promotion.title,
    category_name: promotion.category_name,
    category: promotion.category,
  });
}

function couponMatchRank(coupon, promotion) {
  if (!coupon || !promotion) return 0;
  const couponInfo = couponScope(coupon);
  const promotionInfo = promotionScope(promotion);

  if (!couponInfo.categories.length && !couponInfo.brands.length) return 0;

  if (couponInfo.brands.length) {
    const brandMatch = couponInfo.brands.some(brand =>
      BRAND_KEYWORDS[brand].some(keyword => promotionInfo.text.includes(normalize(keyword))));
    if (!brandMatch) return 0;
    return 2;
  }

  if (couponInfo.categories.length) {
    return couponInfo.categories.some(category => promotionInfo.categories.includes(category)) ? 1 : 0;
  }

  return 0;
}

function isCouponCompatible(coupon, promotion) {
  return couponMatchRank(coupon, promotion) > 0;
}

module.exports = {
  CATEGORY_KEYWORDS,
  BRAND_KEYWORDS,
  normalize,
  detectScope,
  couponScope,
  promotionScope,
  couponMatchRank,
  isCouponCompatible,
};
