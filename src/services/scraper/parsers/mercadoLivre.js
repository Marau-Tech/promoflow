const { parseGeneric, parseNumber } = require('./generic');

/** Lê um bloco .andes-money-amount e devolve o valor numérico. */
function readAmount($, el) {
  const fraction = $(el).find('.andes-money-amount__fraction').first().text().trim();
  if (!fraction) return null;
  const cents = $(el).find('.andes-money-amount__cents').first().text().trim();
  return parseNumber(`${fraction},${cents || '00'}`);
}

function parseMercadoLivre($, finalUrl, html = '') {
  const base = parseGeneric($, finalUrl);

  // =========================================================
  // SKU: prioriza o ID de catálogo (/p/MLB...), depois o ID do anúncio
  // =========================================================
  const findCatalog = (text = '') => {
    const m = String(text).match(/\/p\/(MLB\d{6,})/i);
    return m ? m[1].toUpperCase() : null;
  };
  const findAny = (text = '') => {
    const m = String(text).match(/MLB-?(\d{6,})/i);
    return m ? `MLB${m[1]}` : null;
  };
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const ogUrl = $('meta[property="og:url"]').attr('content') || '';
  const sku = findCatalog(finalUrl) || findCatalog(canonical) || findCatalog(ogUrl)
    || findCatalog(html.match(/\/p\/MLB\d{6,}/i)?.[0])
    || findAny(html.match(/"catalog_product_id"\s*:\s*"(MLB\d{6,})"/i)?.[1])
    || findAny(finalUrl) || findAny(canonical) || findAny(ogUrl)
    || findAny($('[itemprop="sku"]').attr('content') || $('[itemprop="sku"]').text())
    || base.sku
    || null;


  // ---- Preço "De:" (riscado)
  const prevEl = $('.andes-money-amount--previous, s.andes-money-amount, .ui-pdp-price__original-value').first();
  const original_price = prevEl.length ? readAmount($, prevEl) : null;

  // ---- Preço atual: várias tentativas, da mais específica para a mais genérica
  let price = null;

  // 1) meta itemprop="price" dentro do bloco de preço (ML costuma manter)
  price = parseNumber($('.ui-pdp-price__second-line [itemprop="price"], .ui-pdp-price [itemprop="price"]').first().attr('content'));

  // 2) Primeiro .andes-money-amount que NÃO seja o riscado, dentro da área de preço
  if (!price) {
    const candidates = $('.ui-pdp-price .andes-money-amount, .ui-pdp-price__second-line .andes-money-amount, [class*="price"] .andes-money-amount')
      .filter((_, el) => !$(el).is('.andes-money-amount--previous') && !$(el).closest('s').length);
    for (const el of candidates.toArray()) {
      const v = readAmount($, el);
      if (v) { price = v; break; }
    }
  }

  // 3) Qualquer .andes-money-amount não riscado da página
  if (!price) {
    const any = $('.andes-money-amount').filter((_, el) => !$(el).is('.andes-money-amount--previous') && !$(el).closest('s').length).first();
    if (any.length) price = readAmount($, any);
  }

  // 4) JSON-LD / meta tags (parser genérico)
  if (!price) price = base.price;

  // 5) Último recurso: procurar "price":123.45 no JSON embutido do ML
  if (!price && html) {
    const m = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
    if (m) price = parseNumber(m[1]);
  }

  // Se só achou um valor e ele está marcado como "anterior", é o preço atual
  const finalPrice = price || original_price;
  const finalOriginal = price ? original_price : null;

  const title = $('.ui-pdp-title').first().text().trim() || base.title;
  const image = $('.ui-pdp-gallery__figure img').first().attr('data-zoom')
    || $('.ui-pdp-gallery__figure img').first().attr('src')
    || $('meta[property="og:image"]').attr('content')
    || base.image_url;

  return { ...base, sku, title, price: finalPrice, original_price: finalOriginal, image_url: image };
}

module.exports = { parseMercadoLivre };