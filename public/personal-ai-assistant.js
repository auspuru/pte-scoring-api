(() => {
  'use strict';

  const MOCK_SECTIONS = new Set([
    'mock-tests',
    'writing-mocks',
    'writing-run',
    'writing-history',
    'reading'
  ]);

  let root = null;
  let launcher = null;
  let panel = null;

  function appIsVisible() {
    const shell = document.getElementById('appShell');
    if (!shell || shell.hidden) return false;
    const style = window.getComputedStyle(shell);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function shouldShow() {
    const section = document.body.dataset.section || 'dashboard';
    return appIsVisible() && !MOCK_SECTIONS.has(section);
  }

  function syncVisibility() {
    if (!root) return;
    const show = shouldShow();
    root.hidden = !show;
    if (!show) togglePanel(false);
  }

  function togglePanel(force) {
    if (!root || root.hidden) return;
    const open = typeof force === 'boolean' ? force : !root.classList.contains('is-open');
    root.classList.toggle('is-open', open);
    launcher?.setAttribute('aria-expanded', String(open));
    panel?.setAttribute('aria-hidden', String(!open));

    if (open && launcher) {
      launcher.classList.remove('is-waving');
      void launcher.offsetWidth;
      launcher.classList.add('is-waving');
      window.setTimeout(() => launcher?.classList.remove('is-waving'), 900);
    }
  }

  function mount() {
    if (document.getElementById('personalAiAssistant')) return;

    root = document.createElement('aside');
    root.id = 'personalAiAssistant';
    root.className = 'personal-ai-assistant';
    root.setAttribute('aria-label', 'Personal AI Assistant');
    root.innerHTML = [
      '<section class="personal-ai-panel" id="personalAiPanel" aria-hidden="true">',
        '<div class="personal-ai-panel-head">',
          '<div>',
            '<h3>Personal AI Assistant</h3>',
            '<p class="personal-ai-coming-soon">Coming Soon</p>',
          '</div>',
          '<button type="button" class="personal-ai-close" aria-label="Close assistant preview">×</button>',
        '</div>',
      '</section>',
      '<button type="button" class="personal-ai-launcher" aria-label="Personal AI Assistant — Coming Soon" aria-controls="personalAiPanel" aria-expanded="false">',
        '<img class="personal-ai-mascot-art" src="/assets/personal-ai-assistant.png?v=5" alt="Personal AI Assistant — Coming Soon">',
      '</button>'
    ].join('');

    document.body.appendChild(root);
    launcher = root.querySelector('.personal-ai-launcher');
    panel = root.querySelector('.personal-ai-panel');

    launcher?.addEventListener('click', () => togglePanel());
    root.querySelector('.personal-ai-close')?.addEventListener('click', () => togglePanel(false));

    document.addEventListener('pointerdown', event => {
      if (!root?.classList.contains('is-open')) return;
      if (event.target instanceof Node && !root.contains(event.target)) togglePanel(false);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root?.classList.contains('is-open')) {
        togglePanel(false);
        launcher?.focus();
      }
    });

    syncVisibility();

    const shell = document.getElementById('appShell');
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, {
      attributes:true,
      attributeFilter:['data-section','class','style']
    });
    if (shell) observer.observe(shell, {
      attributes:true,
      attributeFilter:['class','style','hidden']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, {once:true});
  } else {
    mount();
  }
})();