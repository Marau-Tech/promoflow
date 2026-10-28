require('dotenv').config();
const app = require('./app');
const { initDatabase } = require('./config/database');
const whatsappService = require('./services/messaging/whatsappService');
const logger = require('./services/logger');

initDatabase();

logger.info('sistema', 'Aplicação iniciada', {
  node_env: process.env.NODE_ENV || 'development',
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  whatsapp_enabled: process.env.WHATSAPP_ENABLED === 'true',
}, 'server');

require('./services/scheduler').start();

if (process.env.WHATSAPP_ENABLED === 'true') {
  whatsappService.init().catch(err => {
    logger.error('whatsapp', 'Falha ao iniciar o WhatsApp', logger.errorMeta(err), 'server');
    console.error('[WhatsApp] Falha ao iniciar:', err.message);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PromoFlow rodando em http://localhost:${PORT}`));

// Auto Discovery Scheduler
const autoDiscovery = require('./services/autoDiscovery');
const { getConfig } = require('./services/autoDiscovery/config');

setInterval(async () => {
  try {
    const cfg = getConfig();
    if (cfg.enabled === false || cfg.enabled === 'false') return;
    const now = Date.now();
    const last = global.__autoDiscLast || 0;
    const intervalMs = (Number(cfg.interval_minutes) || 45) * 60000;
    if (now - last < intervalMs) return;
    global.__autoDiscLast = now;
    console.log('[AutoDiscovery] Execução agendada iniciada...');
    await autoDiscovery.runOnce({ triggered_by: 'scheduler' });
    console.log('[AutoDiscovery] Execução agendada finalizada');
  } catch (e) {
    logger.error('mercadolivre', 'Erro no agendador da descoberta automática', logger.errorMeta(e), 'server');
    console.error('[AutoDiscovery] Erro no agendador:', e.message);
  }
}, 60000);

// Checagem de cupons esgotados (a busca completa de cupons continua manual em /cupons)
const couponDiscovery = require('./services/couponDiscovery');
const couponConfig = require('./services/couponDiscovery/config');

setInterval(async () => {
  try {
    const cfg = couponConfig.getConfig();
    const intervalMs = (Number(cfg.interval_minutes) || 30) * 60000;
    if (Date.now() - (global.__couponExhaustLast || 0) < intervalMs) return;
    global.__couponExhaustLast = Date.now();
    const result = await couponDiscovery.checkExhausted();
    if (result.exhausted || result.exhaustedNotified) {
      console.log(`[Cupons] ${result.exhausted} esgotado(s), ${result.exhaustedNotified} avisado(s)`);
    }
  } catch (e) {
    logger.error('cupons_ml', 'Erro na checagem de cupons esgotados', logger.errorMeta(e), 'server');
  }
}, 60000);

process.on('unhandledRejection', (reason) => {
  logger.error('sistema', 'Promessa rejeitada sem tratamento', logger.errorMeta(reason), 'process');
});

process.on('uncaughtException', (err) => {
  logger.error('sistema', 'Exceção não capturada', logger.errorMeta(err), 'process');
});
