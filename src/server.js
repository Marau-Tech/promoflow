require('dotenv').config();
const app = require('./app');
const { initDatabase } = require('./config/database');
const whatsappService = require('./services/messaging/whatsappService');

initDatabase();

if (process.env.WHATSAPP_ENABLED === 'true') {
  whatsappService.init();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PromoFlow rodando em http://localhost:${PORT}`));
