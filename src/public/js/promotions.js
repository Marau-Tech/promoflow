(() => {
  const { maxLinks, slogans, groups, stores } = window.PROMO_DATA;
  const linksEl = document.getElementById('links');
  const results = document.getElementById('results');
  const groupPicker = document.getElementById('groupPicker');
  const storeSelect = document.getElementById('storeHint');

  const pad = n => String(n).padStart(2, '0');
  const toInputDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDT = d => d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /* ---------- Helper de API ---------- */
  const api = async (url, method, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro na requisição');
    return data;
  };

  /* ---------- Detecção automática da loja ---------- */
  let storeManuallySet = false;
  storeSelect.addEventListener('change', () => { storeManuallySet = storeSelect.value !== ''; });

  function detectStoreClient(url = '') {
    const found = stores.find(s => new RegExp(s.pattern, 'i').test(url));
    return found ? found.key : '';
  }
  function autoDetectStore() {
    if (storeManuallySet) return;
    const first = getLinks()[0];
    storeSelect.value = first ? detectStoreClient(first) : '';
  }

  /* ---------- Entrada de links ---------- */
  function addLinkRow(value = '') {
    if (linksEl.children.length >= maxLinks) return toast(`Máximo de ${maxLinks} links`, 'err');
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<input class="linkInput" placeholder="https://..."><button type="button" class="btn btn-light btn-xs rm">✕</button>`;
    const input = row.querySelector('input');
    input.value = value;

    row.querySelector('.rm').onclick = () => {
      row.remove();
      if (!linksEl.children.length) addLinkRow();
      updateCount();
      autoDetectStore();
    };
    input.addEventListener('paste', e => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const lines = text.split(/\s+/).filter(Boolean);
      if (lines.length > 1) {
        e.preventDefault();
        e.target.value = lines[0];
        lines.slice(1).forEach(l => addLinkRow(l));
        updateCount();
        autoDetectStore();
      }
    });
    input.addEventListener('input', autoDetectStore);

    linksEl.appendChild(row);
    updateCount();
  }
  function updateCount() { document.getElementById('linkCount').textContent = `${linksEl.children.length}/${maxLinks}`; }
  function getLinks() { return [...document.querySelectorAll('.linkInput')].map(i => i.value.trim()).filter(Boolean); }

  document.getElementById('addLink').onclick = () => addLinkRow();
  document.getElementById('clearAll').onclick = resetScreen;
  document.getElementById('autoSend').onchange = e => groupPicker.classList.toggle('hidden', !e.target.checked);
  addLinkRow();

  /* ---------- Geração ---------- */
  let generatedIds = [];

  document.getElementById('generate').onclick = async e => {
    const links = getLinks();
    if (!links.length) return toast('Informe pelo menos um link', 'err');
    const autoSend = document.getElementById('autoSend').checked;
    const groupIds = [...document.querySelectorAll('.groupCheck:checked')].map(c => Number(c.value));
    if (autoSend && !groupIds.length) return toast('Selecione os grupos para envio automático', 'err');

    e.target.disabled = true; e.target.textContent = '⏳ Gerando...';
    try {
      const { results: list } = await api('/api/promotions/generate', 'POST', {
        links,
        templateId: Number(document.getElementById('templateId').value),
        autoSend,
        groupIds,
        storeHint: storeManuallySet ? (storeSelect.value || null) : null,
      });
      results.innerHTML = '';
      generatedIds = [];
      if (linksEl) {
        linksEl.innerHTML = '';
        addLinkRow();
      }
      storeSelect.value = '';
      storeManuallySet = false;
      list.forEach((r, i) => {
        if (r.ok) {
          generatedIds.push(r.promotion.id);
          renderCard(r.promotion, i + 1);
          if (r.sendReport) reportToast(r.sendReport);
        } else {
          const div = document.createElement('div'); div.className = 'card err-card';
          div.textContent = `❌ Falha em ${r.url}: ${r.error}`; results.appendChild(div);
        }
      });
      toast(`${list.filter(r => r.ok).length} promoção(ões) gerada(s)`);
      showBatchPanel();
    } catch (err) { toast(err.message, 'err'); }
    finally { e.target.disabled = false; e.target.textContent = '⬇️ Gerar promoção(ões)'; }
  };

  function reportToast(report) {
    const ok = report.filter(r => r.ok).length;
    toast(`Enviado para ${ok}/${report.length} grupo(s)`, ok === report.length ? 'ok' : 'err');
  }

  /* ---------- Card de promoção ---------- */
  function renderCard(p, idx) {
    const node = document.getElementById('promoCard').content.cloneNode(true);
    const card = node.querySelector('.promo-card');
    card.dataset.id = p.id;
    card.querySelector('.idx').textContent = idx;
    card.querySelector('.store-badge').textContent = p.store_label;

    const cp = card.querySelector('[name=coupon_id]');
    cp.innerHTML = `<option value="">Nenhum</option>` + p.available_coupons.map(c => `<option value="${c.id}">${c.code}</option>`).join('');
    const sl = card.querySelector('[name=slogan_id]');
    sl.innerHTML = `<option value="">Nenhum</option>` + slogans.map(s => `<option value="${s.id}">${s.text}</option>`).join('');

    fill(card, p);
    card.querySelector('[name=slogan_id]').value = '';

    let timer;
    card.querySelectorAll('input[name], select[name]').forEach(el => {
      el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => save(card), 500); });
      el.addEventListener('change', () => { clearTimeout(timer); save(card); });
    });

    card.querySelector('.copyBtn').onclick = () => {
      navigator.clipboard.writeText(card.querySelector('.raw').textContent); toast('Texto copiado!');
    };

    // ----- Enviar para grupos: passo 1 (grupos) -> passo 2 (agora ou agendar)
    const picker = card.querySelector('.send-picker');
    picker.innerHTML = groups.length
      ? `<div class="step1">
           ${groups.map(g => `<label class="checkbox"><input type="checkbox" value="${g.id}"> ${g.platform === 'whatsapp' ? '🟢' : '🔵'} ${g.name}</label>`).join('')}
           <button class="btn btn-primary btn-xs next">Avançar ›</button>
         </div>
         <div class="step2 hidden">
           <p class="muted small selected-info"></p>
           <div class="choice-row">
             <button class="btn btn-primary btn-xs doSend">⚡ Enviar agora</button>
             <button class="btn btn-xs doSchedule">🗓️ Agendar</button>
             <button class="btn btn-xs back">‹ Voltar</button>
           </div>
         </div>`
      : `<p class="warn">Nenhum grupo cadastrado. <a href="/grupos">Conectar</a></p>`;

    card.querySelector('.sendBtn').onclick = () => picker.classList.toggle('hidden');

    const step1 = picker.querySelector('.step1');
    const step2 = picker.querySelector('.step2');
    const selectedIds = () => [...picker.querySelectorAll('.step1 input:checked')].map(i => Number(i.value));

    picker.querySelector('.next')?.addEventListener('click', () => {
      const ids = selectedIds();
      if (!ids.length) return toast('Selecione pelo menos um grupo', 'err');
      picker.querySelector('.selected-info').textContent = `${ids.length} grupo(s) selecionado(s)`;
      step1.classList.add('hidden'); step2.classList.remove('hidden');
    });
    picker.querySelector('.back')?.addEventListener('click', () => {
      step2.classList.add('hidden'); step1.classList.remove('hidden');
    });
    picker.querySelector('.doSend')?.addEventListener('click', async ev => {
      ev.target.disabled = true;
      try {
        const res = await api(`/api/promotions/${p.id}/send`, 'POST', { groupIds: selectedIds() });
        reportToast(res.report);
        // Limpa o card após envio
        card.remove();
        generatedIds = generatedIds.filter(id => id !== p.id);
        const batch = document.getElementById('batchPanel');
        if (batch && !document.querySelectorAll('.promo-card').length) batch.classList.add('hidden');
      }
      catch (err) { toast(err.message, 'err'); }
      finally { ev.target.disabled = false; }
    });
    picker.querySelector('.doSchedule')?.addEventListener('click', () => openScheduleModal(p.id, selectedIds()));

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

  /* ---------- Modal de agendamento (uma promoção) ---------- */
  const modal = document.getElementById('scheduleModal');
  const schedTime = document.getElementById('schedTime');
  const schedDate = document.getElementById('schedDate');
  const schedPreview = document.getElementById('schedPreview');
  let scheduling = { promotionId: null, groupIds: [] };

  function openScheduleModal(promotionId, groupIds) {
    scheduling = { promotionId, groupIds };
    document.getElementById('schedGroups').innerHTML =
      `<p class="small"><strong>${groupIds.length} grupo(s) selecionado(s)</strong></p>` +
      groupIds.map(id => { const g = groups.find(x => x.id === id); return g ? `<span class="chip">${g.name}</span>` : ''; }).join('');
    const now = new Date();
    schedDate.min = toInputDate(now);
    schedDate.max = toInputDate(new Date(now.getTime() + 10 * 86400000));
    if (!schedDate.value) schedDate.value = toInputDate(now);
    if (!schedTime.value) { const t = new Date(now.getTime() + 3600000); schedTime.value = `${pad(t.getHours())}:${pad(t.getMinutes())}`; }
    updateSchedPreview();
    modal.classList.remove('hidden');
  }
  function scheduledDate() {
    if (!schedDate.value || !schedTime.value) return null;
    return new Date(`${schedDate.value}T${schedTime.value}:00`);
  }
  function updateSchedPreview() {
    const d = scheduledDate();
    schedPreview.textContent = d && !Number.isNaN(d.getTime())
      ? `🗓️ Envio agendado para ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} às ${schedTime.value}`
      : 'Informe data e horário';
  }
  schedDate.addEventListener('input', updateSchedPreview);
  schedTime.addEventListener('input', updateSchedPreview);

  const closeModal = () => modal.classList.add('hidden');
  document.getElementById('schedClose').onclick = closeModal;
  document.getElementById('schedBack').onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.getElementById('schedConfirm').onclick = async ev => {
    const d = scheduledDate();
    if (!d || Number.isNaN(d.getTime())) return toast('Informe data e horário', 'err');
    if (d.getTime() < Date.now()) return toast('Escolha um horário no futuro', 'err');
    ev.target.disabled = true;
    try {
      await api('/api/schedules', 'POST', { promotionId: scheduling.promotionId, groupIds: scheduling.groupIds, scheduledAt: d.toISOString() });
      closeModal();
      // Remove card
      const card = document.querySelector(`.promo-card[data-id="${scheduling.promotionId}"]`);
      if (card) card.remove();
      generatedIds = generatedIds.filter(id => id !== scheduling.promotionId);
      if (!document.querySelectorAll('.promo-card').length) document.getElementById('batchPanel')?.classList.add('hidden');
      toast('Agendamento criado! Veja em Agendamentos.');
    } catch (err) { toast(err.message, 'err'); }
    finally { ev.target.disabled = false; }
  };

  /* ---------- Agendamento em lote (todas as promoções geradas) ---------- */
  const batchPanel = document.getElementById('batchPanel');
  const batchMode = document.getElementById('batchStartMode');
  const batchDate = document.getElementById('batchDate');
  const batchTime = document.getElementById('batchTime');
  const batchInterval = document.getElementById('batchInterval');
  const batchCustom = document.getElementById('batchCustom');
  const batchPreview = document.getElementById('batchPreview');

  function intervalMinutes() {
    return batchInterval.value === 'custom' ? Math.max(1, Number(batchCustom.value) || 1) : Number(batchInterval.value);
  }
  function batchStart() {
    if (batchMode.value === 'now') return new Date();
    if (!batchDate.value || !batchTime.value) return null;
    return new Date(`${batchDate.value}T${batchTime.value}:00`);
  }
  function updateBatchPreview() {
    const n = generatedIds.length, start = batchStart(), iv = intervalMinutes();
    document.getElementById('batchCount').textContent = `${n} promoção(ões)`;
    if (!n || !start || Number.isNaN(start.getTime())) { batchPreview.textContent = 'Informe início e intervalo'; return; }
    const end = new Date(start.getTime() + (n - 1) * iv * 60000);
    batchPreview.textContent = n === 1
      ? `🗓️ 1 envio em ${fmtDT(start)}`
      : `🗓️ ${n} envios, um a cada ${iv} min — de ${fmtDT(start)} até ${fmtDT(end)}`;
  }
  function showBatchPanel() {
    if (!generatedIds.length) return hideBatchPanel();
    const now = new Date();
    batchDate.min = toInputDate(now);
    batchDate.max = toInputDate(new Date(now.getTime() + 10 * 86400000));
    if (!batchDate.value) batchDate.value = toInputDate(now);
    if (!batchTime.value) { const t = new Date(now.getTime() + 3600000); batchTime.value = `${pad(t.getHours())}:${pad(t.getMinutes())}`; }
    updateBatchPreview();
    batchPanel.classList.remove('hidden');
  }
  function hideBatchPanel() {
    batchPanel.classList.add('hidden');
    generatedIds = [];
  }

  function resetScreen() {
    linksEl.innerHTML = '';
    addLinkRow();
    results.innerHTML = '';
    storeManuallySet = false;
    storeSelect.value = '';
    document.getElementById('autoSend').checked = false;
    groupPicker.classList.add('hidden');
    document.querySelectorAll('.groupCheck, .batchGroup').forEach(c => c.checked = false);
    batchMode.value = 'now';
    document.querySelectorAll('.batch-when').forEach(el => el.classList.add('hidden'));
    batchDate.value = ''; batchTime.value = '';
    hideBatchPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  batchMode.addEventListener('change', () => {
    document.querySelectorAll('.batch-when').forEach(el => el.classList.toggle('hidden', batchMode.value !== 'at'));
    updateBatchPreview();
  });
  batchInterval.addEventListener('change', () => {
    document.getElementById('batchCustomWrap').classList.toggle('hidden', batchInterval.value !== 'custom');
    updateBatchPreview();
  });
  [batchDate, batchTime, batchCustom].forEach(el => el.addEventListener('input', updateBatchPreview));

  document.getElementById('batchConfirm').onclick = async ev => {
    const groupIds = [...document.querySelectorAll('.batchGroup:checked')].map(c => Number(c.value));
    if (!groupIds.length) return toast('Selecione pelo menos um grupo', 'err');
    const start = batchStart();
    if (!start || Number.isNaN(start.getTime())) return toast('Informe data e hora de início', 'err');
    ev.target.disabled = true;
    try {
      const r = await api('/api/schedules/batch', 'POST', {
        promotionIds: generatedIds, groupIds, startAt: start.toISOString(), intervalMinutes: intervalMinutes(),
      });
      toast(`${r.created} agendamento(s) criado(s). Veja em Agendamentos.`);
      resetScreen();
    } catch (err) { toast(err.message, 'err'); }
    finally { ev.target.disabled = false; }
  };
})();