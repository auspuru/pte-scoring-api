(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalExamMode = api.createController(root.document, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createController(doc, win) {
    let active = null, observer = null;
    const blocked = new Map();
    function isolate() {
      if (!active) return;
      let branch = active.pane;
      while (branch && branch !== doc.body) {
        const parent = branch.parentElement;
        if (!parent) break;
        for (const sibling of parent.children) {
          if (sibling === branch || ['SCRIPT','STYLE','LINK'].includes(sibling.tagName)) continue;
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
      observer?.disconnect(); observer = null;
      for (const [node, inert] of blocked) {
        node.removeAttribute('data-exam-blocked'); node.inert = inert;
      }
      blocked.clear();
      if (active) {
        active.pane.classList.remove('portal-exam-surface');
        if (active.tabindex === null) active.pane.removeAttribute('tabindex');
        else active.pane.setAttribute('tabindex', active.tabindex);
      }
      active = null;
      doc.body.classList.remove('portal-exam-active');
    }
    function set(owner, enabled, pane) {
      if (!enabled) { if (active?.owner === owner) reset(); return; }
      if (!pane || pane.hidden || (active && active.owner !== owner)) return;
      if (active?.pane === pane) return;
      reset();
      active = { owner, pane, tabindex:pane.getAttribute('tabindex') };
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
    }
    return { set, reset, isActive:() => !!active };
  }
  return { createController };
});
