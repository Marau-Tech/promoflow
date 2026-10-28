const MLCoupon = require('../models/MLCoupon');
const couponDisc = require('../services/couponDiscovery');
const { getConfig, setConfig } = require('../services/couponDiscovery/config');
const Group = require('../models/Group');
const dispatcher = require('../services/messaging/dispatcher');
const { buildCouponMessage, buildCouponsListMessage, BATCH_SIZE } = require('../services/couponDiscovery');
const { db } = require('../config/database');
const logger = require('../services/logger');

exports.index = (req,res)=>{
  try {
    res.render('cupons/ml/index',{
      title:'Cupons Mercado Livre',
      coupons: MLCoupon.all(),
      config: getConfig(),
      groups: Group.active(),
      page: 'coupons_ml'
    });
  } catch (e) {
    logger.error('cupons_ml', 'Falha ao carregar a página de cupons', logger.errorMeta(e), 'cupons_ml');
    res.render('cupons/ml/index',{
      title:'Cupons Mercado Livre',
      coupons: [],
      config: getConfig(),
      groups: Group.active(),
      page: 'coupons_ml'
    });
  }
};

exports.discover = async (req,res,next)=>{
  try{
    const r = await couponDisc.runOnce();
    try { if (couponDisc.syncToCoupons) couponDisc.syncToCoupons(); } catch(e){}
    res.json(r);
  }catch(e){ next(e); }
};

exports.publish = async (req,res,next)=>{
  try{
    const cup = db.prepare('SELECT * FROM ml_coupons WHERE id=?').get(req.params.id);
    if(!cup) return next(Object.assign(new Error('Cupom não encontrado'), { status: 404 }));
    const { groupIds=[] } = req.body;
    if(!groupIds.length) return next(Object.assign(new Error('Selecione pelo menos um grupo'), { status: 400 }));
    const msg = buildCouponMessage(cup);
    const report = await dispatcher.sendMessageToGroups(msg, groupIds.map(Number));
    try { MLCoupon.markPublished(cup.id); } catch(e){}
    try { MLCoupon.logPublish({ml_coupon_id:cup.id, group_ids:groupIds.map(Number), message:msg, status:'sent', report_json:JSON.stringify(report)}); }
    catch(e){ logger.warn('cupons_ml', 'Falha ao registrar publicação de cupom', logger.errorMeta(e, { coupon_id: cup.id }), 'cupons_ml'); }
    logger.info('cupons_ml', 'Cupom divulgado', { coupon_id: cup.id, code: cup.code, groups: report.length }, 'cupons_ml');
    res.json({ok:true, report});
  }catch(e){ next(e); }
};

exports.publishSelected = async (req,res,next)=>{
  try{
    const couponIds = [...new Set((Array.isArray(req.body?.couponIds) ? req.body.couponIds : []).map(Number).filter(Boolean))];
    const groupIds = [...new Set((Array.isArray(req.body?.groupIds) ? req.body.groupIds : []).map(Number).filter(Boolean))];
    if(!couponIds.length) return next(Object.assign(new Error('Selecione pelo menos um cupom'), { status: 400 }));
    if(!groupIds.length) return next(Object.assign(new Error('Selecione pelo menos um grupo'), { status: 400 }));

    const validGroups = Group.findByIds(groupIds);
    if(!validGroups.length) return next(Object.assign(new Error('Nenhum grupo válido encontrado'), { status: 400 }));
    const targetGroupIds = validGroups.map(g => Number(g.id));

    const placeholders = couponIds.map(() => '?').join(',');
    const found = db.prepare(`SELECT * FROM ml_coupons WHERE id IN (${placeholders})`).all(...couponIds);
    const byId = new Map(found.map(c => [Number(c.id), c]));
    const all = couponIds.map(id => byId.get(id)).filter(Boolean);
    if(!all.length) return next(Object.assign(new Error('Nenhum cupom encontrado'), { status: 404 }));
    const list = all.filter(c => !c.queued_at);
    const skippedQueued = all.length - list.length;
    if(!list.length) return next(Object.assign(new Error('Todos os cupons selecionados já estão na fila de envio'), { status: 400 }));

    const cfg = getConfig();
    const chunks = [];
    for(let i = 0; i < list.length; i += BATCH_SIZE) chunks.push(list.slice(i, i + BATCH_SIZE));

    const report = [];
    for(const chunk of chunks){
      const message = buildCouponsListMessage(chunk, { includeRules: cfg.include_rules !== false });
      const result = await dispatcher.sendMessageToGroups(message, targetGroupIds, {
        category: 'cupons_ml',
        source: 'manual',
      });
      report.push(...result);
      for(const cup of chunk){
        try { MLCoupon.markPublished(cup.id); } catch(e){}
        try {
          MLCoupon.logPublish({
            ml_coupon_id: cup.id,
            group_ids: targetGroupIds,
            message,
            status: 'sent',
            report_json: JSON.stringify(result),
          });
        } catch(e){
          logger.warn('cupons_ml', 'Falha ao registrar envio manual de cupom', logger.errorMeta(e, { coupon_id: cup.id }), 'cupons_ml');
        }
      }
    }

    const sent = report.filter(r => r.ok).length;
    const failed = report.filter(r => !r.ok).length;
    logger.info('cupons_ml', 'Cupons enviados manualmente', {
      coupons: list.length,
      skipped_queued: skippedQueued,
      messages: chunks.length,
      groups: targetGroupIds.length,
      sent,
      failed,
    }, 'cupons_ml');

    res.json({ ok: true, coupons: list.length, skipped: skippedQueued, messages: chunks.length, sent, failed, report });
  }catch(e){ next(e); }
};

exports.publishAll = async (req,res,next)=>{
  try{
    const cfg = getConfig();
    let groupIds = Array.isArray(req.body?.groupIds) && req.body.groupIds.length ? req.body.groupIds : cfg.group_ids;
    groupIds = (groupIds || []).map(Number).filter(Boolean);
    if(!groupIds.length) return next(Object.assign(new Error('Selecione pelo menos um grupo'), { status: 400 }));

    const list = MLCoupon.active().filter(c => !c.queued_at);
    if(!list.length) return next(Object.assign(new Error('Todos os cupons ativos já estão na fila de envio'), { status: 400 }));

    const queued = couponDisc.enqueueCoupons(list, groupIds, {
      includeRules: cfg.include_rules !== false,
      source: 'manual',
    });
    logger.info('cupons_ml', 'Lotes de cupons agendados manualmente', {
      batches: queued.batches,
      coupons: queued.coupons,
      groups: groupIds.length,
      first: queued.first,
      last: queued.last,
    }, 'cupons_ml');
    res.json({
      ok: true,
      scheduled: queued.batches,
      coupons: queued.coupons,
      first: queued.first,
      last: queued.last,
    });
  }catch(e){ next(e); }
};

exports.saveConfig = (req,res,next)=>{
  try{
    const config = setConfig(req.body||{});
    logger.info('cupons_ml', 'Configuração de cupons salva', config, 'cupons_ml');
    res.json({config});
  }catch(e){ next(e); }
};

exports.toggle = (req,res,next)=>{
  try { const { active } = req.body; MLCoupon.toggle(req.params.id, active); logger.info('cupons_ml', 'Cupom ativado/desativado', { coupon_id: req.params.id, active }, 'cupons_ml'); res.json({ok:true}); }
  catch(e){ next(e); }
};

exports.toggleAutoPublish = (req,res,next)=>{
  try { const { v } = req.body; MLCoupon.setAutoPublish(req.params.id, v); logger.info('cupons_ml', 'Publicação automática do cupom alterada', { coupon_id: req.params.id, auto_publish: v }, 'cupons_ml'); res.json({ok:true}); }
  catch(e){ next(e); }
};
