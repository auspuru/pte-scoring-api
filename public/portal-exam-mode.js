(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalExamMode = api.createController(root.document, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const reasons = { 'tab-hidden':'Test tab hidden', 'window-blur':'Test window lost focus', 'fullscreen-exit':'Fullscreen exited',
    'fullscreen-required':'Protected screen required', 'external-paste-blocked':'External paste blocked', 'external-drop-blocked':'External drop blocked' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function reportHTML(integrity) {
    if (!integrity?.protected) return '';
    const events = integrity.events || [];
    return '<details class="portal-exam-report"><summary>Protected mock · '+events.length+' recorded interruption'+(events.length===1?'':'s')+'</summary><p>These browser events describe interruptions; they do not prove outside assistance and do not change the score.</p>'+
      (events.length ? '<ol>'+events.map(event => '<li>'+escape(reasons[event.reason] || event.reason)+' · '+escape(new Date(event.receivedAt ?? event.at).toLocaleString())+'</li>').join('')+'</ol>' : '<p>No interruptions recorded.</p>')+'</details>';
  }
  function createController(doc, win) {
    let active = null, observer = null;
    let guard, heading, message, enter, cancel, error;
    let clipboard = null, internalDrag = false;
    const blocked = new Map();
    const focused = () => !doc.hidden && (!doc.hasFocus || doc.hasFocus());
    const fullscreen = () => doc.fullscreenElement === doc.documentElement;
    function emit(reason) {
      active?.options?.onEvent?.({ id:win.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2), reason, at:Date.now() });
    }
    function makeGuard() {
      if (guard) return;
      guard = doc.createElement('dialog'); guard.id = 'portal-exam-guard'; guard.className = 'portal-exam-guard';
      guard.oncancel = event => event.preventDefault();
      guard.setAttribute('tabindex','-1');
      guard.setAttribute('role','dialog'); guard.setAttribute('aria-modal','true'); guard.setAttribute('aria-labelledby','portal-exam-guard-title');
      const card = doc.createElement('div'); card.className = 'portal-exam-guard-card';
      heading = doc.createElement('h2'); heading.id = 'portal-exam-guard-title';
      message = doc.createElement('p');
      error = doc.createElement('p'); error.setAttribute('role','alert'); error.className = 'portal-exam-guard-error';
      enter = doc.createElement('button'); enter.type = 'button'; enter.className = 'portal-button primary';
      cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'portal-button'; cancel.textContent = 'Back to mock tests';
      for (const node of [heading,message,error,enter,cancel]) card.appendChild(node);
      guard.appendChild(card); guard.hidden = true; doc.body.appendChild(guard);
      cancel.onclick = () => { if (active?.options.pending) reset(); };
      enter.onclick = async () => {
        const current = active;
        if (!current?.locked) return;
        enter.disabled = true; error.textContent = '';
        try {
          if (!doc.documentElement?.requestFullscreen || doc.fullscreenEnabled === false) throw Error('Use a browser that supports fullscreen to take a protected mock.');
          if (!fullscreen()) {
            await doc.documentElement.requestFullscreen({ navigationUI:'hide' });
            if (active !== current) return;
            current.ownsFullscreen = true;
          }
          if (!fullscreen() || !focused()) throw Error('Return to this test window, then select the button again.');
          if (current.options.pending) {
            heading.textContent = 'Preparing your mock…'; message.textContent = 'Keep this window open. Your timer starts when the questions are ready.';
            enter.hidden = true; cancel.hidden = true;
          } else {
            unlock(current);
            current.pane.focus({ preventScroll:true });
          }
          current.options.onResume?.();
          const ready = current.ready; current.ready = null; ready?.(true);
        } catch (failure) { if (active === current) error.textContent = failure.message || 'Fullscreen could not start. Please try again.'; }
        finally { enter.disabled = false; }
      };
    }
    function lock(reason, record = true) {
      if (!active?.options || active.locked) return;
      const current = active;
      current.locked = true; current.pane.inert = true;
      makeGuard();
      const pending = current.options.pending;
      heading.textContent = pending ? 'Begin your protected mock' : 'Return to your protected mock';
      message.textContent = pending ? 'Fullscreen is required. Leaving this tab or window locks the questions and records an interruption. The timer continues once the mock starts. Copy and paste stays inside this mock.' : 'The questions are locked. Your timer is still running. Return to fullscreen to continue; this interruption is recorded with your attempt.';
      enter.textContent = pending ? 'Enter fullscreen and begin mock' : 'Return to fullscreen';
      enter.hidden = false;
      cancel.hidden = !pending; error.textContent = ''; guard.hidden = false;
      if (!guard.open) guard.showModal();
      if (record && !pending) emit(reason);
      current.options.onLock?.();
      enter.focus({ preventScroll:true });
    }
    function unlock(current) {
      current.locked = false;
      current.pane.inert = false;
      // Hiding an open native modal still blocks response fields. Always
      // close it when the runner starts, rerenders or resumes unlocked.
      if (guard) { guard.close(); guard.hidden = true; }
    }
    function isolate() {
      if (!active) return;
      let branch = active.pane;
      while (branch && branch !== doc.body) {
        const parent = branch.parentElement;
        if (!parent) break;
        for (const sibling of parent.children) {
          if (sibling === branch || sibling === guard || ['SCRIPT','STYLE','LINK'].includes(sibling.tagName)) continue;
          // The standalone Writing Lab keeps its submission dialog outside #lab.
          if (active.pane.id === 'lab' && ['confirm-dialog','notice'].includes(sibling.id)) continue;
          if (!blocked.has(sibling)) {
            blocked.set(sibling, !!sibling.inert);
            sibling.inert = true;
            sibling.setAttribute('data-exam-blocked', '');
          }
        }
        branch = parent;
      }
    }
    function reset() {
      const current = active;
      active = null;
      current?.ready?.(false);
      if (guard) { guard.close(); guard.hidden = true; }
      clipboard = null; internalDrag = false;
      observer?.disconnect(); observer = null;
      for (const [node, inert] of blocked) {
        node.removeAttribute('data-exam-blocked'); node.inert = inert;
      }
      blocked.clear();
      if (current) {
        current.pane.inert = current.inert;
        current.pane.classList.remove('portal-exam-surface');
        if (current.tabindex === null) current.pane.removeAttribute('tabindex');
        else current.pane.setAttribute('tabindex', current.tabindex);
      }
      doc.body.classList.remove('portal-exam-active');
      if (current?.ownsFullscreen && fullscreen()) Promise.resolve(doc.exitFullscreen?.()).catch(() => {});
    }
    function set(owner, enabled, pane, options = null) {
      if (!enabled) { if (active?.owner === owner) reset(); return; }
      if (!pane || pane.hidden || (active && active.owner !== owner)) return;
      if (active?.pane === pane) {
        const ready = active.options?.pending && !options?.pending;
        active.options = options;
        if (ready || !active.locked) unlock(active);
        if(options?.pending) { active.locked = false; lock('fullscreen-required',false); }
        if (options && !options.pending && (!fullscreen() || !focused())) lock('fullscreen-required');
        return;
      }
      reset();
      active = { owner, pane, options, inert:!!pane.inert, tabindex:pane.getAttribute('tabindex') };
      pane.inert = false;
      doc.body.classList.remove('portal-menu-open');
      doc.getElementById('portalMenuToggle')?.setAttribute('aria-expanded', 'false');
      doc.body.classList.add('portal-exam-active');
      pane.classList.add('portal-exam-surface');
      isolate();
      if (win.MutationObserver) {
        observer = new win.MutationObserver(isolate);
        // Watch only ancestor children, not edits inside the question. New
        // launchers or dialogs are hidden without doing work on every keystroke.
        for (let node = pane.parentElement; node; node = node.parentElement) {
          observer.observe(node, { childList:true });
          if (node === doc.body) break;
        }
      }
      if (!pane.contains(doc.activeElement)) {
        pane.setAttribute('tabindex', '-1'); pane.focus({ preventScroll:true });
      }
      if (options && (options.pending || !fullscreen() || !focused())) lock('fullscreen-required');
    }
    function prepare(owner, pane) {
      set(owner, true, pane, { pending:true });
      if (active?.owner !== owner) return Promise.resolve(false);
      return new Promise(resolve => { active.ready = resolve; });
    }
    function editor(target) {
      return active?.pane.contains(target) && /^(TEXTAREA|INPUT)$/.test(target?.tagName) && !target.disabled && !target.readOnly ? target : null;
    }
    function insert(target, text) {
      const input = editor(target);
      if (!input || text == null) return;
      input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');
      input.dispatchEvent(new win.Event('input',{bubbles:true})); input.focus();
    }
    function copy(target, cut) {
      const input = editor(target);
      const text = input ? input.value.slice(input.selectionStart,input.selectionEnd) : doc.getSelection?.()?.toString();
      if (text) clipboard = text;
      if (cut && input && text) insert(input,'');
    }
    function edit(command, target) {
      if (!active?.options) return false;
      if (active.locked) return true;
      if (command === 'paste') { if (clipboard != null) insert(target,clipboard); else lock('external-paste-blocked'); }
      else copy(target,command === 'cut');
      return true;
    }
    doc.addEventListener?.('visibilitychange', () => { if (doc.hidden) lock('tab-hidden'); });
    win.addEventListener?.('blur', () => { if (!focused()) lock('window-blur'); });
    doc.addEventListener?.('focusin', event => {
      if (active?.locked && !guard.contains(event.target)) {
        (enter.hidden ? guard : enter).focus({ preventScroll:true });
      }
    }, true);
    win.addEventListener?.('beforeunload', () => { if(active?.options && !active.options.pending && !active.locked) emit('fullscreen-required'); });
    doc.addEventListener?.('fullscreenchange', () => { if (!fullscreen()) lock('fullscreen-exit'); });
    for (const type of ['copy','cut','paste']) doc.addEventListener?.(type, event => {
      if (!active?.options) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (active.locked) return;
      if (type === 'paste') {
        // Never read the system clipboard: only text copied inside this mock
        // can enter a response, including through the native paste shortcut.
        if (clipboard != null) insert(event.target,clipboard); else lock('external-paste-blocked');
      } else copy(event.target,type === 'cut');
    }, true);
    doc.addEventListener?.('contextmenu', event => { if (active?.options) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    doc.addEventListener?.('keydown', event => {
      if (!active?.options) return;
      const key=String(event.key).toLowerCase();
      if (active.locked && key === 'tab') {
        const buttons = [enter,cancel].filter(button => !button.hidden && !button.disabled);
        const index = buttons.indexOf(doc.activeElement);
        const target = buttons.length ? buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length] : guard;
        event.preventDefault(); target.focus({ preventScroll:true }); return;
      }
      if (['f5','f12','contextmenu'].includes(key) || ((event.ctrlKey || event.metaKey) && ['l','t','n','w','r','u','p','s'].includes(key))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    doc.addEventListener?.('dragstart', event => { internalDrag = !!active?.pane.contains(event.target); }, true);
    doc.addEventListener?.('dragend', () => { internalDrag = false; }, true);
    doc.addEventListener?.('drop', event => {
      if (active?.options && !internalDrag) { event.preventDefault(); event.stopImmediatePropagation(); lock('external-drop-blocked'); }
      internalDrag = false;
    }, true);
    return { set, reset, prepare, edit, reportHTML, isActive:() => !!active, isLocked:owner => !!active?.locked && (!owner || active.owner === owner) };
  }
  return { createController, reportHTML };
});
