require('dotenv').config();
const app = require('./app');
const { initDatabase } = require('./config/database');
const whatsappService = require('./services/messaging/whatsappService');

initDatabase();

require('./services/scheduler').start();

if (process.env.WHATSAPP_ENABLED === 'true') {
  whatsappService.init().catch(err => console.error('[WhatsApp] Falha ao iniciar:', err.message));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PromoFlow rodando em http://localhost:${PORT}`));
