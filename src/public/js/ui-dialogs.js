(function () {
  let dialog;
  let titleEl;
  let messageEl;
  let inputWrap;
  let inputLabel;
  let inputEl;
  let cancelBtn;
  let confirmBtn;
  let pending = null;
  let ignoreNextClose = false;

  function ensureDialog() {
    if (dialog) return;

    dialog = document.createElement('dialog');
    dialog.className = 'modal pf-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="modal-card">
        <header class="modal-header">
          <h3 class="modal-title"></h3>
          <button type="button" class="modal-close" aria-label="Fechar">✕</button>
        </header>
        <div class="modal-body">
          <p class="pf-dialog-message"></p>
          <label class="field pf-dialog-input hidden">
            <span class="pf-dialog-label"></span>
            <input type="text" autocomplete="off">
          </label>
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn pf-dialog-cancel">Cancelar</button>
          <button type="submit" value="confirm" class="btn btn-primary pf-dialog-confirm">OK</button>
        </footer>
      </form>`;

    document.body.appendChild(dialog);

    titleEl = dialog.querySelector('.modal-title');
    messageEl = dialog.querySelector('.pf-dialog-message');
    inputWrap = dialog.querySelector('.pf-dialog-input');
    inputLabel = dialog.querySelector('.pf-dialog-label');
    inputEl = inputWrap.querySelector('input');
    cancelBtn = dialog.querySelector('.pf-dialog-cancel');
    confirmBtn = dialog.querySelector('.pf-dialog-confirm');

    dialog.querySelector('.modal-close').addEventListener('click', () => close('cancel'));
    cancelBtn.addEventListener('click', () => close('cancel'));
    dialog.addEventListener('click', event => {
      if (event.target === dialog) close('cancel');
    });
    dialog.addEventListener('close', () => {
      if (ignoreNextClose) {
        ignoreNextClose = false;
        return;
      }
      const current = pending;
      pending = null;
      if (!current) return;

      const value = dialog.returnValue;
      if (current.mode === 'alert') current.resolve();
      else if (current.mode === 'confirm') current.resolve(value === 'confirm');
      else if (current.mode === 'prompt') current.resolve(value === 'confirm' ? inputEl.value.trim() : null);
    });
    inputEl.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        close('confirm');
      }
    });
  }

  function close(value) {
    if (dialog && dialog.open) dialog.close(value);
  }

  function open(options) {
    ensureDialog();

    return new Promise(resolve => {
      const current = { mode: options.mode, resolve };
      if (pending) {
        const previous = pending;
        pending = null;
        previous.resolve(previous.mode === 'prompt' ? null : previous.mode === 'confirm' ? false : undefined);
      }
      if (dialog.open) {
        ignoreNextClose = true;
        dialog.close('cancel');
      }
      pending = current;

      titleEl.textContent = options.title;
      messageEl.textContent = options.message || '';
      messageEl.classList.toggle('hidden', !options.message);

      const hasInput = options.mode === 'prompt';
      inputWrap.classList.toggle('hidden', !hasInput);
      if (hasInput) {
        inputLabel.textContent = options.label || '';
        inputEl.value = options.value || '';
        inputEl.placeholder = options.placeholder || '';
      }

      const isAlert = options.mode === 'alert';
      cancelBtn.classList.toggle('hidden', isAlert);
      cancelBtn.textContent = options.cancelText || 'Cancelar';
      confirmBtn.textContent = options.confirmText || (isAlert ? 'Entendi' : 'Confirmar');
      confirmBtn.className = `btn ${options.tone === 'danger' ? 'btn-danger' : 'btn-primary'} pf-dialog-confirm`;

      dialog.returnValue = '';
      dialog.showModal();

      requestAnimationFrame(() => {
        if (hasInput) inputEl.focus();
        else confirmBtn.focus();
      });
    });
  }

  function normalize(options, defaults = {}) {
    if (typeof options === 'string') return { ...defaults, message: options };
    return { ...defaults, ...(options || {}) };
  }

  window.PFUI = {
    alert(options) {
      const opts = normalize(options, { title: 'Aviso', confirmText: 'Entendi' });
      return open({ mode: 'alert', ...opts });
    },
    confirm(options) {
      const opts = normalize(options, {
        title: 'Confirmar ação',
        message: 'Tem certeza que deseja continuar?',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        tone: 'danger',
      });
      return open({ mode: 'confirm', ...opts });
    },
    prompt(options) {
      const opts = normalize(options, {
        title: 'Informe um valor',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
      });
      return open({ mode: 'prompt', ...opts });
    },
  };

  function bindConfirmForms(root = document) {
    root.querySelectorAll('form[data-confirm]').forEach(form => {
      if (form.dataset.pfConfirmBound) return;
      form.dataset.pfConfirmBound = '1';
      form.addEventListener('submit', async event => {
        if (form.dataset.pfConfirmed === '1') return;
        event.preventDefault();
        const ok = await window.PFUI.confirm({
          title: form.dataset.confirmTitle || 'Confirmar ação',
          message: form.dataset.confirm,
          confirmText: form.dataset.confirmText || 'Confirmar',
          cancelText: form.dataset.confirmCancel || 'Cancelar',
          tone: form.dataset.confirmDanger === 'true' ? 'danger' : 'primary',
        });
        if (!ok) return;
        form.dataset.pfConfirmed = '1';
        form.submit();
      });
    });
  }

  window.PFUI.bindConfirmForms = bindConfirmForms;
  document.addEventListener('DOMContentLoaded', () => bindConfirmForms());
})();
