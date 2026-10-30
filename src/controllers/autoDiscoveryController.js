const { getConfig, setConfig } = require('../services/autoDiscovery/config');
const autoDiscovery = require('../services/autoDiscovery');
const promotionService = require('../services/promotionService');
const AutoDiscoveryRun = require('../models/AutoDiscoveryRun');
const AutoDiscoveryCandidate = require('../models/AutoDiscoveryCandidate');
const Promotion = require('../models/Promotion');
const Schedule = require('../models/Schedule');
const sendPlanner = require('../services/sendPlanner');
const Group = require('../models/Group');
const mlAuth = require('../services/mlAuth');
const logger = require('../services/logger');
const affiliate = require('../services/affiliate');

const LINK_KEYS = ['affiliate_url', 'affiliate_tag', 'affiliate_tool'];
const CANDIDATE_STATUSES = ['new', 'generated', 'sent', 'skipped'];

/** Configuração sem os cookies da sessão do ML, para exibir e registrar em log. */
function publicConfig(cfg = getConfig()) {
  const { ml_session_cookies: cookies, ...rest } = cfg;
  return { ...rest, has_ml_session: Boolean(String(cookies || '').trim()) };
}

exports.index = (req, res) => {
  const candidateStatus = CANDIDATE_STATUSES.includes(req.query.status) ? req.query.status : '';
  res.render('auto-discovery/index', {
    title: 'Descoberta Automática',
    config: publicConfig(),
    runs: AutoDiscoveryRun.recent(10),
    candidates: AutoDiscoveryCandidate.list(200, candidateStatus),
    candidateStatus,
    candidateCounts: AutoDiscoveryCandidate.counts(),
    groups: Group.active(),
    mlConfigured: mlAuth.isConfigured(),
    mlConnected: mlAuth.isConnected(),
    mlError: req.query.ml_error || '',
    mlConnectedFlag: req.query.ml_connected === '1',
    mlRedirectUri: mlAuth.redirectUri(),
    resendScheduled: req.query.resend !== undefined ? Number(req.query.resend) || 0 : null,
    resendSkipped: Number(req.query.skipped) || 0,
    resendError: req.query.resend_error || '',
  });
};

exports.getConfig = (req, res) => {
  res.json({ config: publicConfig() });
};

exports.saveConfig = (req, res) => {
  try {
    const before = getConfig();
    const updates = { ...(req.body || {}) };
    // Cookies em branco mantêm a sessão salva; só são apagados a pedido.
    const cookies = String(updates.ml_session_cookies || '').trim();
    if (cookies && /(?:^|;)\s*(?:max-age|expires|path|domain)=/i.test(cookies)) {
      return res.status(400).json({
        error: 'Isso é um "Set-Cookie" (resposta), não o cabeçalho "Cookie" da requisição. '
          + 'No F12 → Rede, clique numa requisição para mercadolivre.com.br e copie, em "Cabeçalhos da solicitação", '
          + 'o valor de "Cookie" (uma linha longa com vários nome=valor; separados por ponto e vírgula).',
      });
    }
    delete updates.ml_session_cookies;
    delete updates.clear_ml_session;
    if (cookies) updates.ml_session_cookies = cookies;
    else if (req.body?.clear_ml_session) updates.ml_session_cookies = '';

    const cfg = setConfig(updates);
    const affiliateChanged = LINK_KEYS.some(k => String(before[k] || '') !== String(cfg[k] || ''));
    if (affiliateChanged) {
      const updated = promotionService.refreshMessages();
      logger.info('mercadolivre', 'Link de afiliado atualizado nas promoções', { updated }, 'auto_discovery');
    }
    logger.info('mercadolivre', 'Configuração da descoberta salva', publicConfig(cfg), 'auto_discovery');
    res.json({ config: publicConfig(cfg) });
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao salvar configuração da descoberta', logger.errorMeta(e), 'auto_discovery');
    res.locals.__errorLogged = true;
    res.status(500).json({ error: e.message });
  }
};

exports.run = async (req, res, next) => {
  try {
    logger.info('mercadolivre', 'Descoberta manual solicitada', null, 'auto_discovery');
    const result = await autoDiscovery.runOnce({ triggered_by: 'manual' });
    res.json(result);
  } catch (e) {
    logger.error('mercadolivre', 'Falha na descoberta manual', logger.errorMeta(e), 'auto_discovery');
    res.locals.__errorLogged = true;
    next(e);
  }
};

function parseIds(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  return [...new Set(list.map(Number).filter(Boolean))];
}

function scheduleResends(promotionIds, groupIds) {
  const ids = [];
  let skipped = 0;
  for (const promotionId of promotionIds) {
    const promotion = Promotion.find(promotionId);
    if (!promotion) { skipped++; continue; }
    if (Schedule.pendingForPromotion(promotionId)) { skipped++; continue; }
    ids.push(promotionId);
  }

  const queued = sendPlanner.enqueuePromotions(ids, groupIds);
  skipped += ids.length - queued.length;
  const items = queued.map(({ promotion_id, schedule, scheduledAt }) => ({
    promotion_id,
    schedule_id: schedule.id,
    scheduled_at: scheduledAt.toISOString(),
  }));

  logger.info('mercadolivre', 'Reenvio de ofertas anteriores agendado', {
    requested: promotionIds.length,
    scheduled: items.length,
    skipped,
    group_ids: groupIds,
  }, 'auto_discovery');

  return { scheduled: items.length, skipped, items };
}

exports.resend = (req, res, next) => {
  try {
    const body = req.body || {};
    const promotionIds = parseIds(body.promotionIds);
    const groupIds = parseIds(body.groupIds);

    if (!promotionIds.length) return res.status(400).json({ error: 'Selecione pelo menos uma oferta.' });
    if (!groupIds.length) return res.status(400).json({ error: 'Selecione pelo menos um grupo.' });

    res.json(scheduleResends(promotionIds, groupIds));
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao reagendar ofertas anteriores', logger.errorMeta(e), 'auto_discovery');
    res.locals.__errorLogged = true;
    next(e);
  }
};

exports.resendForm = (req, res, next) => {
  try {
    const body = req.body || {};
    const promotionIds = parseIds(body.promotionIds);
    const groupIds = parseIds(body.groupIds);
    if (!promotionIds.length) {
      return res.redirect('/descobrir?resend_error=' + encodeURIComponent('Selecione pelo menos uma oferta.'));
    }
    if (!groupIds.length) {
      return res.redirect('/descobrir?resend_error=' + encodeURIComponent('Selecione pelo menos um grupo.'));
    }
    const result = scheduleResends(promotionIds, groupIds);
    res.redirect(`/descobrir?resend=${result.scheduled}&skipped=${result.skipped}`);
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao reagendar ofertas anteriores', logger.errorMeta(e), 'auto_discovery');
    res.locals.__errorLogged = true;
    next(e);
  }
};


exports.testAffiliate = async (req, res) => {
  const url = String(req.body?.url || 'https://www.mercadolivre.com.br/p/MLB40656539').trim();
  const tracked = affiliate.trackedUrl(url);
  try {
    const [short] = await affiliate.createShortLinks([affiliate.cleanProductUrl(url)]);
    if (!short) throw new Error('O Mercado Livre não devolveu o link meli.la.');
    logger.info('mercadolivre', 'Teste de geração de meli.la concluído', { url, short_url: short }, 'auto_discovery');
    res.json({ ok: true, short_url: short, tracked_url: tracked });
  } catch (e) {
    logger.warn('mercadolivre', 'Teste de geração de meli.la falhou', logger.errorMeta(e, { url }), 'auto_discovery');
    res.json({ ok: false, error: e.message, tracked_url: tracked });
  }
};

exports.runs = (req, res) => {
  res.json({ runs: AutoDiscoveryRun.recent(20) });
};

exports.candidates = (req, res) => {
  const status = CANDIDATE_STATUSES.includes(req.query.status) ? req.query.status : null;
  res.json({ candidates: AutoDiscoveryCandidate.list(100, status) });
};
