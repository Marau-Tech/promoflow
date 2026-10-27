(() => {
  const { maxLinks, slogans, groups } = window.PROMO_DATA;
  const linksEl = document.getElementById('links');
  const results = document.getElementById('results');
  const groupPicker = document.getElementById('groupPicker');

  const api = async (url, method, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro na requisição');
    return data;
  };

  function addLinkRow(value = '') {
    if (linksEl.children.length >= maxLinks) return toast(`Máximo de ${maxLinks} links`, 'err');
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<input class="linkInput" placeholder="https://..."><button type="button" class="btn btn-light btn-xs rm">✕</button>`;
    row.querySelector('input').value = value;
    row.querySelector('.rm').onclick = () => { row.remove(); if (!linksEl.children.length) addLinkRow(); updateCount(); };
    row.querySelector('input').addEventListener('paste', e => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const lines = text.split(/\s+/).filter(Boolean);
      if (lines.length > 1) { e.preventDefault(); e.target.value = lines[0]; lines.slice(1).forEach(l => addLinkRow(l)); updateCount(); }
    });
    linksEl.appendChild(row);
    updateCount();
  }
  function updateCount() { document.getElementById('linkCount').textContent = `${linksEl.children.length}/${maxLinks}`; }
  function getLinks() { return [...document.querySelectorAll('.linkInput')].map(i => i.value.trim()).filter(Boolean); }

  document.getElementById('addLink').onclick = () => addLinkRow();
  document.getElementById('clearAll').onclick = () => { linksEl.innerHTML = ''; addLinkRow(); results.innerHTML = ''; };
  document.getElementById('autoSend').onchange = e => groupPicker.classList.toggle('hidden', !e.target.checked);
  addLinkRow();

  document.getElementById('generate').onclick = async e => {
    const links = getLinks();
    if (!links.length) return toast('Informe pelo menos um link', 'err');
    const autoSend = document.getElementById('autoSend').checked;
    const groupIds = [...document.querySelectorAll('.groupCheck:checked')].map(c => Number(c.value));
    if (autoSend && !groupIds.length) return toast('Selecione os grupos para envio automático', 'err');

    e.target.disabled = true; e.target.textContent = '⏳ Gerando...';
    try {
      const { results: list } = await api('/api/promotions/generate', 'POST', {
  	links, templateId: Number(document.getElementById('templateId').value), autoSend, groupIds,
  	storeHint: document.getElementById('storeHint').value || null,
      });
      results.innerHTML = '';
      list.forEach((r, i) => {
        if (r.ok) { renderCard(r.promotion, i + 1); if (r.sendReport) reportToast(r.sendReport); }
        else {
          const div = document.createElement('div'); div.className = 'card err-card';
          div.textContent = `❌ Falha em ${r.url}: ${r.error}`; results.appendChild(div);
        }
      });
      toast(`${list.filter(r => r.ok).length} promoção(ões) gerada(s)`);
    } catch (err) { toast(err.message, 'err'); }
    finally { e.target.disabled = false; e.target.textContent = '⬇️ Gerar promoção(ões)'; }
  };

  function reportToast(report) {
    const ok = report.filter(r => r.ok).length;
    toast(`Enviado para ${ok}/${report.length} grupo(s)`, ok === report.length ? 'ok' : 'err');
  }

  function renderCard(p, idx) {
    const node = document.getElementById('promoCard').content.cloneNode(true);
    const card = node.querySelector('.promo-card');
    card.dataset.id = p.id;
    card.querySelector('.idx').textContent = idx;
    card.querySelector('.store-badge').textContent = p.store_label;

    const cp = card.querySelector('[name=coupon_id]');
    cp.innerHTML = `<option value="">Nenhum cupom</option>` + p.available_coupons.map(c => `<option value="${c.id}">${c.code}</option>`).join('');
    const sl = card.querySelector('[name=slogan_id]');
    sl.innerHTML = `<option value="">Nenhum</option>` + slogans.map(s => `<option value="${s.id}">${s.text}</option>`).join('');

    fill(card, p);

    let timer;
    card.querySelectorAll('input[name], select[name]').forEach(el => {
      el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => save(card), 500); });
      el.addEventListener('change', () => { clearTimeout(timer); save(card); });
    });

    card.querySelector('.copyBtn').onclick = () => {
      navigator.clipboard.writeText(card.querySelector('.raw').textContent); toast('Texto copiado!');
    };

    const picker = card.querySelector('.send-picker');
    picker.innerHTML = groups.length
      ? groups.map(g => `<label class="checkbox"><input type="checkbox" value="${g.id}"> ${g.platform === 'whatsapp' ? '🟢' : '🔵'} ${g.name}</label>`).join('')
        + `<button class="btn btn-primary btn-xs doSend">Enviar agora</button>`
      : `<p class="warn">Nenhum grupo cadastrado. <a href="/grupos">Conectar</a></p>`;
    card.querySelector('.sendBtn').onclick = () => picker.classList.toggle('hidden');
    picker.querySelector('.doSend')?.addEventListener('click', async ev => {
      const ids = [...picker.querySelectorAll('input:checked')].map(i => Number(i.value));
      if (!ids.length) return toast('Selecione um grupo', 'err');
      ev.target.disabled = true;
      try { reportToast((await api(`/api/promotions/${p.id}/send`, 'POST', { groupIds: ids })).report); }
      catch (err) { toast(err.message, 'err'); }
      finally { ev.target.disabled = false; }
    });

    results.appendChild(node);
  }

  function fill(card, p) {
    ['sku', 'title', 'original_price', 'price', 'image_url', 'url'].forEach(n => card.querySelector(`[name=${n}]`).value = p[n] ?? '');
    card.querySelector('[name=coupon_id]').value = p.coupon_id || '';
    card.querySelector('[name=slogan_id]').value = p.slogan_id || '';
    card.querySelector('.head-title').textContent = p.title || '(sem título)';
    const img = card.querySelector('.wa-img');
    img.src = p.image_url || ''; img.style.display = p.image_url ? '' : 'none';
    card.querySelector('.wa-text').innerHTML = waFormat(p.message);
    card.querySelector('.raw').textContent = p.message;
  }

  async function save(card) {
    const body = {};
    card.querySelectorAll('input[name], select[name]').forEach(el => body[el.name] = el.value);
    try { fill(card, (await api(`/api/promotions/${card.dataset.id}`, 'PUT', body)).promotion); }
    catch (err) { toast(err.message, 'err'); }
  }

  function waFormat(text = '') {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/\*(.+?)\*/g, '<b>$1</b>')
      .replace(/~(.+?)~/g, '<s>$1</s>')
      .replace(/_(.+?)_/g, '<i>$1</i>')
      .replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank">$1</a>')
      .replace(/\n/g, '<br>');
  }
})();
