const { db } = require('../../config/database');
function getConfig(){
  try {
    const rows=db.prepare('SELECT key,value FROM ml_coupon_config').all();
    const cfg={enabled:true,auto_publish:true,interval_minutes:30,max_publish_per_run:3,group_ids:[],include_rules:true,show_price_with_coupon:true};
    for(const r of rows){ try{cfg[r.key]=JSON.parse(r.value);}catch{cfg[r.key]=r.value;} }
    if(typeof cfg.group_ids==='string'){ try{cfg.group_ids=JSON.parse(cfg.group_ids);}catch{cfg.group_ids=[];} }
    cfg.group_ids = (Array.isArray(cfg.group_ids) ? cfg.group_ids : []).map(Number).filter(Boolean);
    return cfg;
  } catch(e){ return {enabled:true,auto_publish:true,interval_minutes:60,group_ids:[]}; }
}
function setConfig(updates={}){
  try {
    const stmt=db.prepare('INSERT INTO ml_coupon_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for(const [k,v] of Object.entries(updates||{})) stmt.run(k, typeof v==='string'?v:JSON.stringify(v));
    return getConfig();
  } catch(e){ return getConfig(); }
}
module.exports={getConfig,setConfig};
