(() => {
  'use strict';

  const routes = {
    dashboard: ['ipt', 'IPT Brisbane'],
    'practice-hub': ['pte-ai', 'PTE practice'],
    swt: ['swt', 'Summarise Written Text'],
    practice: ['essay', 'Essay practice'],
    'spoken-text': ['listening', 'Summarise Spoken Text'],
    dictation: ['listening', 'Write From Dictation'],
    'mock-tests': ['mock-test', 'Mock Tests'],
    'writing-mocks': ['mock-test', 'Writing mock'],
    'writing-run': ['mock-test', 'Writing mock'],
    reading: ['mock-test', 'Reading mock'],
    progress: ['progress', 'My Progress'],
    'next-steps': ['teacher-feedback', 'From your teacher'],
    vocab: ['vocab', 'Vocabulary'],
    library: ['essay', 'Essay library'],
    'reading-dropdown': ['reading', 'Reading practice'],
    'reading-mcma': ['reading', 'Reading practice'],
    'reading-reorder': ['reading', 'Reading practice'],
    'reading-wordbank': ['reading', 'Reading practice'],
    'reading-mcsa': ['reading', 'Reading practice'],
    'listening-hcs': ['listening', 'Listening practice'],
    'listening-hiw': ['listening', 'Listening practice'],
    'speaking-ra': ['speaking', 'Speaking practice'],
    'speaking-rs': ['speaking', 'Speaking practice'],
    'speaking-di': ['speaking', 'Speaking practice'],
    'speaking-rl': ['speaking', 'Speaking practice'],
    'speaking-sgd': ['speaking', 'Speaking practice'],
    'speaking-rts': ['speaking', 'Speaking practice']
  };

  const effects = {
    ipt: '<span class="brand-halo"></span><span class="brand-ray"></span><span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span>',
    'pte-ai': '<span class="scan"></span><span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>',
    'score-90': '<span class="confetti c1"></span><span class="confetti c2"></span><span class="confetti c3"></span><span class="confetti c4"></span>',
    swt: '<span class="summary-line l1"></span><span class="summary-line l2"></span><span class="summary-line l3"></span><span class="summary-line out"></span>',
    essay: '<span class="wave"></span><span class="pencil"></span>',
    speaking: '<span class="dot"></span><span class="ring r1"></span><span class="ring r2"></span>',
    reading: '<span class="page"></span>',
    listening: '<span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>',
    pronunciation: '<span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>',
    fluency: '<span class="wave"></span><span class="dot"></span>',
    grammar: '<span class="xmark"></span><span class="checkmark"></span>',
    vocab: '<span class="bubble b1">+</span><span class="bubble b2">W</span><span class="bubble b3">+</span>',
    'mock-test': '<span class="tick t1"></span><span class="tick t2"></span><span class="tick t3"></span>',
    progress: '<span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="bar b4"></span><span class="wave"></span><span class="progress-arrow"></span><span class="progress-badge">✓</span>',
    'teacher-feedback': '<span class="feedback"></span><span class="checkmark"></span>',
    'ai-score': '<span class="scan"></span><span class="checkmark"></span>',
    celebrate: '<span class="confetti c1"></span><span class="confetti c2"></span><span class="confetti c3"></span><span class="confetti c4"></span>'
  };

  const iconForText = [
    [/\bgrammar\b/i, 'grammar'],
    [/\bpronunciation\b/i, 'pronunciation'],
    [/\bfluency\b/i, 'fluency'],
    [/\bvocabulary\b/i, 'vocab'],
    [/teacher feedback|from your teacher/i, 'teacher-feedback'],
    [/my progress|progress/i, 'progress'],
    [/mock test/i, 'mock-test'],
    [/summari[sz]e written text|\bswt\b/i, 'swt'],
    [/\bessay\b/i, 'essay'],
    [/\bspeaking\b/i, 'speaking'],
    [/\breading\b/i, 'reading'],
    [/\blistening\b/i, 'listening'],
    [/ai score|pte estimate/i, 'ai-score'],
    [/score 90|congratulations|excellent result/i, 'score-90']
  ];

  let contextButton = null;
  let currentEmoji = '';
  let pulseTimer = 0;
  let mutationTimer = 0;

  function asset(id) { return '/brand-emojis/' + id + '.svg?v=4'; }

  function setMarkup(el, id, label) {
    el.dataset.emoji = id;
    el.setAttribute('aria-label', label || id);
    el.innerHTML = '<img src="' + asset(id) + '" alt=""><span class="fx" aria-hidden="true">' + (effects[id] || '') + '</span>';
  }

  function activate(el, duration = 900) {
    if (!el) return;
    el.classList.remove('is-active');
    void el.offsetWidth;
    el.classList.add('is-active');
    if (duration > 0) {
      window.clearTimeout(el._iptEmojiTimer);
      el._iptEmojiTimer = window.setTimeout(() => el.classList.remove('is-active'), duration);
    }
  }

  function ensureContext() {
    if (contextButton?.isConnected) return contextButton;
    const heading = document.querySelector('.topbar-heading');
    if (!heading) return null;
    const wrap = document.createElement('div');
    wrap.className = 'portal-emoji-context-wrap';
    wrap.innerHTML = '<button type="button" class="ipt-action-emoji portal-emoji-context" id="portalActionEmoji"></button><span class="portal-emoji-context-label" id="portalActionEmojiLabel"></span>';
    heading.parentElement?.insertBefore(wrap, heading.nextSibling);
    contextButton = wrap.querySelector('#portalActionEmoji');
    contextButton?.addEventListener('click', () => activate(contextButton, 900));
    return contextButton;
  }

  function routeEmoji() {
    const section = document.body.dataset.section || 'dashboard';
    return routes[section] || ['pte-ai', 'PTE practice'];
  }

  function syncContext(replay = false) {
    const button = ensureContext();
    if (!button) return;
    const [id, label] = routeEmoji();
    if (currentEmoji !== id) {
      currentEmoji = id;
      setMarkup(button, id, label);
      const labelNode = document.getElementById('portalActionEmojiLabel');
      if (labelNode) labelNode.textContent = label;
      replay = true;
    }
    if (replay) activate(button, 850);
  }

  function setContextOverride(id, label, active = false) {
    const button = ensureContext();
    if (!button) return;
    currentEmoji = id;
    setMarkup(button, id, label);
    const labelNode = document.getElementById('portalActionEmojiLabel');
    if (labelNode) labelNode.textContent = label;
    if (active) activate(button, 0);
  }

  function visible(node) {
    return !!node && !node.hidden && node.offsetParent !== null;
  }

  function syncSemanticState() {
    const phase = document.getElementById('speaking-phase');
    if (visible(phase)) {
      const text = phase.textContent || '';
      if (/recording/i.test(text)) {
        setContextOverride('speaking', 'Recording', true);
        return;
      }
      if (/saving/i.test(text)) {
        setContextOverride('ai-score', 'Saving response', true);
        return;
      }
      if (/recording saved/i.test(text)) {
        setContextOverride('celebrate', 'Recording saved');
        activate(contextButton, 900);
        return;
      }
    }

    const activePane = document.querySelector('.pane.active:not([hidden]), .pane.show:not([hidden])');
    const text = activePane?.textContent || '';
    if (/checking|scoring|assessing|generating feedback/i.test(text)) {
      setContextOverride('ai-score', 'AI scoring', true);
      return;
    }
    syncContext(false);
  }

  function mini(id, label) {
    const span = document.createElement('span');
    span.className = 'portal-mini-emoji ipt-action-emoji';
    setMarkup(span, id, label);
    span.setAttribute('aria-hidden', 'true');
    return span;
  }


  const sidebarEmojis = {
    'nav-dashboard': ['ipt', 'Home'],
    'nav-practice-hub': ['pte-ai', 'Practice'],
    'nav-mock-tests': ['mock-test', 'Mock Tests'],
    'nav-next-steps': ['teacher-feedback', 'From your teacher'],
    'nav-progress': ['progress', 'My Progress'],
    'nav-vocab': ['vocab', 'Vocabulary'],
    'nav-library': ['essay', 'Essay library'],
    'nav-admin': ['pte-ai', 'Admin Panel']
  };

  function decorateSidebarNav() {
    Object.entries(sidebarEmojis).forEach(([buttonId, config]) => {
      const button = document.getElementById(buttonId);
      if (!button) return;
      let icon = button.querySelector('.nav-icon');
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'nav-icon';
        button.prepend(icon);
      }
      if (icon.dataset.brandEmoji === config[0]) return;
      icon.className = 'nav-icon portal-nav-emoji ipt-action-emoji';
      icon.dataset.brandEmoji = config[0];
      setMarkup(icon, config[0], config[1]);
      icon.setAttribute('aria-hidden', 'true');
      button.addEventListener('pointerdown', () => activate(icon, config[0] === 'progress' ? 1150 : 780));
    });
  }

  function syncSidebarEmoji() {
    const active = document.querySelector('.sidebar-menu .nav-item.active .portal-nav-emoji');
    if (active) activate(active, active.dataset.emoji === 'progress' ? 1150 : 760);
  }

  function decorateHomeCards() {
    document.querySelectorAll('.home-skill-card:not([data-emoji-ready])').forEach(card => {
      const text = card.textContent || '';
      let id = null;
      if (/speaking/i.test(text)) id = 'speaking';
      else if (/writing/i.test(text)) id = 'essay';
      else if (/reading/i.test(text)) id = 'reading';
      else if (/listening/i.test(text)) id = 'listening';
      if (!id) return;
      card.dataset.emojiReady = '1';
      card.prepend(mini(id, text.trim()));
      card.addEventListener('pointerdown', () => activate(card.querySelector('.portal-mini-emoji'), 700));
    });
  }

  function decorateSemanticLabels(root = document) {
    root.querySelectorAll?.('h2,h3,h4,.progress-caption,.next-step-kicker,.speaking-footnote').forEach(node => {
      if (node.dataset.emojiReady || node.closest('.portal-emoji-context-wrap')) return;
      const text = (node.textContent || '').trim();
      const match = iconForText.find(([rx]) => rx.test(text));
      if (!match) return;
      node.dataset.emojiReady = '1';
      node.classList.add('portal-label-with-emoji');
      node.prepend(mini(match[1], text));
    });
  }

  function onMutation() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      decorateSidebarNav();
      decorateHomeCards();
      decorateSemanticLabels(document.getElementById('portalContent') || document);
      syncSemanticState();
    }, 60);
  }


  function setupCursorInteractions() {
    const finePointer = window.matchMedia?.('(hover:hover) and (pointer:fine)').matches;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || reduceMotion) return;

    let current = null;

    const reset = el => {
      if (!el) return;
      el.classList.remove('is-cursor-active');
      el.style.setProperty('--cursor-x', '28%');
      el.style.setProperty('--cursor-y', '18%');
      el.style.setProperty('--cursor-tilt-x', '0deg');
      el.style.setProperty('--cursor-tilt-y', '0deg');
    };

    document.addEventListener('pointermove', event => {
      const target = event.target instanceof Element ? event.target.closest('.ipt-action-emoji') : null;
      if (current && current !== target) reset(current);
      if (!target) {
        current = null;
        return;
      }

      current = target;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      const py = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      const tiltY = ((px - 50) / 50) * 5.5;
      const tiltX = ((50 - py) / 50) * 5.5;

      target.classList.add('is-cursor-active');
      target.style.setProperty('--cursor-x', px.toFixed(1) + '%');
      target.style.setProperty('--cursor-y', py.toFixed(1) + '%');
      target.style.setProperty('--cursor-tilt-x', tiltX.toFixed(2) + 'deg');
      target.style.setProperty('--cursor-tilt-y', tiltY.toFixed(2) + 'deg');
    }, {passive:true});

    document.addEventListener('pointerout', event => {
      const target = event.target instanceof Element ? event.target.closest('.ipt-action-emoji') : null;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      reset(target);
      if (current === target) current = null;
    }, true);
  }

  function start() {
    setupCursorInteractions();
    syncContext(true);
    decorateSidebarNav();
    syncSidebarEmoji();
    decorateHomeCards();
    decorateSemanticLabels(document.getElementById('portalContent') || document);

    new MutationObserver(mutations => {
      let routeChanged = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target === document.body && m.attributeName === 'data-section') routeChanged = true;
      }
      if (routeChanged) { syncContext(true); syncSidebarEmoji(); }
      onMutation();
    }).observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['data-section','hidden','class']});

    document.addEventListener('click', event => {
      const scoreButton = event.target.closest('[data-speaking-action="submit"], [data-progress-refresh], [data-plan-ready], #submitBtn, #scoreBtn');
      if (scoreButton) window.setTimeout(() => {
        setContextOverride('ai-score', 'Checking your result', true);
        window.clearTimeout(pulseTimer);
        pulseTimer = window.setTimeout(syncSemanticState, 1800);
      }, 0);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();