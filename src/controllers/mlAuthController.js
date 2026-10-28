const mlAuth = require('../services/mlAuth');
const logger = require('../services/logger');

exports.connect = (req, res) => {
  try {
    const url = mlAuth.createAuthorizationUrl();
    res.redirect(url);
  } catch (e) {
    logger.error('mercadolivre', 'Falha ao iniciar conexão com o Mercado Livre', logger.errorMeta(e), 'ml_auth');
    res.redirect(`/descobrir?ml_error=${encodeURIComponent(e.message)}`);
  }
};

exports.callback = async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    logger.warn('mercadolivre', 'Autorização do Mercado Livre recusada', { error, error_description }, 'ml_auth');
    return res.redirect(`/descobrir?ml_error=${encodeURIComponent(error_description || error)}`);
  }
  if (!code || !state) {
    logger.warn('mercadolivre', 'Callback do Mercado Livre sem code/state', { has_code: Boolean(code), has_state: Boolean(state) }, 'ml_auth');
    return res.redirect(`/descobrir?ml_error=${encodeURIComponent('Callback sem code/state.')}`);
  }
  try {
    await mlAuth.exchangeCode(String(code), String(state));
    res.redirect('/descobrir?ml_connected=1');
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.error_description || e.message;
    logger.error('mercadolivre', 'Falha ao concluir conexão com o Mercado Livre', logger.errorMeta(e, { message: msg }), 'ml_auth');
    res.redirect(`/descobrir?ml_error=${encodeURIComponent(msg)}`);
  }
};

exports.disconnect = (req, res) => {
  mlAuth.disconnect();
  if (req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true });
  }
  res.redirect('/descobrir');
};

exports.status = (req, res) => {
  res.json({ configured: mlAuth.isConfigured(), connected: mlAuth.isConnected(), redirectUri: mlAuth.redirectUri() });
};
