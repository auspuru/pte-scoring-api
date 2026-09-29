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
    if (root) root.hidden = !shouldShow();
  }

  function focusAssistant(attempt = 0) {
    const panel = document.querySelector('.next-step-beta');
    const field = document.querySelector('[data-beta-problem]');
    if (panel) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      window.setTimeout(() => field?.focus(), reduce ? 0 : 250);
      return;
    }
    if (attempt < 20) window.setTimeout(() => focusAssistant(attempt + 1), 100);
  }

  function openAssistant() {
    if (!root || root.hidden) return;
    launcher?.classList.remove('is-waving');
    void launcher?.offsetWidth;
    launcher?.classList.add('is-waving');
    window.setTimeout(() => launcher?.classList.remove('is-waving'), 900);

    if (typeof window.switchSection === 'function') window.switchSection('next-steps');
    else window.location.hash = '#/next-steps';
    window.setTimeout(() => focusAssistant(), 60);
  }

  function mount() {
    if (document.getElementById('personalAiAssistant')) return;

    root = document.createElement('aside');
    root.id = 'personalAiAssistant';
    root.className = 'personal-ai-assistant';
    root.setAttribute('aria-label', 'IPT Assistant shortcut');
    root.innerHTML = [
      '<button type="button" class="personal-ai-launcher" aria-label="Open IPT Assistant" title="Open IPT Assistant">',
        '<img class="personal-ai-mascot-art" src="/assets/personal-ai-assistant.svg?v=3" alt="">',
        '<span class="personal-ai-dot" aria-hidden="true"></span>',
      '</button>'
    ].join('');

    document.body.appendChild(root);
    launcher = root.querySelector('.personal-ai-launcher');
    launcher?.addEventListener('click', openAssistant);

    syncVisibility();

    const shell = document.getElementById('appShell');
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-section', 'class', 'style']
    });
    if (shell) observer.observe(shell, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
