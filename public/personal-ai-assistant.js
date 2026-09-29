(() => {
  'use strict';

  const BLOCKED_SECTIONS = new Set(['mock-tests','writing-mocks','writing-run','reading']);
  const TASK_BY_SECTION = {
    swt:'swt',
    practice:'essay',
    'spoken-text':'sst',
    'speaking-ra':'ra',
    'speaking-rs':'rs',
    'speaking-rl':'rl',
    'speaking-di':'di',
    'speaking-rts':'rts',
    'speaking-sgd':'sgd'
  };

  let root = null;
  let launcher = null;
  let panel = null;
  let chat = null;
  let form = null;
  let input = null;
  let contextLabel = null;
  let contextDetail = null;
  let history = [];
  let busy = false;
  let lastSection = '';
  let selectedText = '';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  function appIsVisible() {
    const shell = document.getElementById('appShell');
    if (!shell || shell.hidden) return false;
    const style = window.getComputedStyle(shell);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function currentSection() {
    return document.body.dataset.section || 'dashboard';
  }

  function shouldShow() {
    return appIsVisible() && !BLOCKED_SECTIONS.has(currentSection());
  }

  function getSessionToken() {
    try {
      return sessionStorage.getItem('pte_impersonate_token')
        || sessionStorage.getItem('pte_session_token')
        || localStorage.getItem('pte_session_token')
        || '';
    } catch (_) {
      return '';
    }
  }

  function activePane() {
    return document.querySelector('.panes-container .pane:not([hidden])')
      || document.querySelector('.pane.active:not([hidden])')
      || document.querySelector('#appShell main:not([hidden])');
  }

  function isUsefulControl(el) {
    if (!el || el.disabled) return false;
    const type = String(el.type || '').toLowerCase();
    return !['password','hidden','file','submit','button','reset'].includes(type);
  }

  function controlLabel(el) {
    const explicit = el.getAttribute('aria-label') || el.getAttribute('placeholder');
    if (explicit) return explicit.trim();
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label?.innerText?.trim()) return label.innerText.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping?.innerText?.trim()) return wrapping.innerText.trim().slice(0,120);
    return el.name || el.id || 'Response field';
  }

  function captureSelection() {
    const pane = activePane();
    const selection = window.getSelection?.();
    if (!pane || !selection || selection.rangeCount < 1 || selection.isCollapsed) return;
    const node = selection.anchorNode;
    if (node && pane.contains(node.nodeType === 1 ? node : node.parentElement)) {
      selectedText = String(selection.toString() || '').trim().slice(0,2500);
    }
  }

  function collectScreenContext() {
    const pane = activePane();
    const section = currentSection();
    const pageTitle = document.getElementById('pageTitle')?.innerText?.trim() || document.title || '';
    const eyebrow = document.getElementById('pageEyebrow')?.innerText?.trim() || '';
    const pageContext = document.getElementById('pageContext')?.innerText?.trim() || '';
    const lines = [
      'PORTAL SECTION: ' + section,
      'PAGE TITLE: ' + pageTitle,
      eyebrow ? 'PAGE TYPE: ' + eyebrow : '',
      pageContext ? 'PAGE CONTEXT: ' + pageContext : ''
    ].filter(Boolean);

    if (selectedText) lines.push('STUDENT SELECTED TEXT:\n' + selectedText);

    if (pane) {
      const controls = [...pane.querySelectorAll('textarea,input,select')]
        .filter(isUsefulControl)
        .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true')
        .slice(0,24)
        .map(el => {
          let value = '';
          if (el instanceof HTMLSelectElement) value = el.selectedOptions?.[0]?.textContent?.trim() || el.value;
          else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? 'selected' : 'not selected';
          else value = String(el.value || '').trim();
          if (!value) return '';
          return controlLabel(el) + ': ' + value.slice(0,3200);
        })
        .filter(Boolean);
      if (controls.length) lines.push('VISIBLE STUDENT INPUTS:\n' + controls.join('\n'));

      const visibleText = String(pane.innerText || '')
        .replace(/[ \t]+/g,' ')
        .replace(/\n{3,}/g,'\n\n')
        .trim()
        .slice(0,8500);
      if (visibleText) lines.push('VISIBLE PAGE TEXT:\n' + visibleText);
    }

    return lines.join('\n\n').slice(0,12000);
  }

  function taskForScreen() {
    return TASK_BY_SECTION[currentSection()] || 'portal';
  }

  function taskLabel() {
    const title = document.getElementById('pageTitle')?.innerText?.trim();
    return title || 'Current PTE screen';
  }

  function formatReply(value) {
    const escaped = escapeHtml(value);
    const lines = escaped.split(/\r?\n/);
    let html = '';
    let list = [];
    const flush = () => {
      if (!list.length) return;
      html += '<ul>' + list.map(item => '<li>' + item + '</li>').join('') + '</ul>';
      list = [];
    };
    for (let line of lines) {
      line = line.trim();
      if (!line) { flush(); continue; }
      line = line
        .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g,'<em>$1</em>');
      const bullet = line.match(/^(?:[-•]|\d+[.)])\s+(.+)/);
      if (bullet) { list.push(bullet[1]); continue; }
      flush();
      const heading = line.match(/^#{1,4}\s+(.+)/);
      html += '<p>' + (heading ? '<strong>' + heading[1] + '</strong>' : line) + '</p>';
    }
    flush();
    return html || '<p></p>';
  }

  function renderChat() {
    if (!chat) return;
    if (!history.length) {
      chat.innerHTML = [
        '<div class="personal-ai-welcome">',
          '<span class="personal-ai-spark" aria-hidden="true">✦</span>',
          '<div>',
            '<strong>I can read this practice screen.</strong>',
            '<p>Ask about the question, your typed response, the feedback shown here, or what you should improve next.</p>',
          '</div>',
        '</div>',
        '<div class="personal-ai-quick-actions">',
          '<button type="button" data-ai-quick="Give me feedback on my response on this screen.">Give feedback</button>',
          '<button type="button" data-ai-quick="What is the most important thing I should improve on this screen?">What should I improve?</button>',
          '<button type="button" data-ai-quick="Explain this question and what I should focus on.">Explain this question</button>',
        '</div>'
      ].join('');
      return;
    }
    chat.innerHTML = history.map(message => [
      '<article class="personal-ai-message ', message.role === 'assistant' ? 'assistant' : 'user', '">',
        '<span>', message.role === 'assistant' ? 'AI Assistant' : 'You', '</span>',
        '<div>', message.role === 'assistant' ? formatReply(message.text) : '<p>' + escapeHtml(message.text) + '</p>', '</div>',
      '</article>'
    ].join('')).join('') + (busy ? '<div class="personal-ai-thinking"><span></span><span></span><span></span><b>Reading this page…</b></div>' : '');
    chat.scrollTop = chat.scrollHeight;
  }

  function refreshContextLabel() {
    if (!contextLabel || !contextDetail) return;
    contextLabel.textContent = taskLabel();
    contextDetail.textContent = selectedText ? 'Reading this page + selected text' : 'Reading this page';
  }

  function resetForNewScreen() {
    const section = currentSection();
    if (section === lastSection) return;
    lastSection = section;
    history = [];
    selectedText = '';
    refreshContextLabel();
    renderChat();
  }

  function togglePanel(force) {
    if (!root || root.hidden) return;
    const open = typeof force === 'boolean' ? force : !root.classList.contains('is-open');
    root.classList.toggle('is-open', open);
    document.body.classList.toggle('personal-ai-panel-open', open);
    launcher?.setAttribute('aria-expanded', String(open));
    panel?.setAttribute('aria-hidden', String(!open));
    if (open) {
      captureSelection();
      resetForNewScreen();
      refreshContextLabel();
      window.setTimeout(() => input?.focus(), 80);
    }
  }

  async function sendMessage(text) {
    const message = String(text || '').trim();
    if (!message || busy) return;
    const token = getSessionToken();
    if (!token) {
      history.push({role:'assistant',text:'Please sign in again so I can use your current portal context.'});
      renderChat();
      return;
    }

    const screenContext = collectScreenContext();
    if (!screenContext.trim()) {
      history.push({role:'assistant',text:'I cannot see enough practice content on this screen yet. Open a question or result, then ask me again.'});
      renderChat();
      return;
    }

    history.push({role:'user',text:message});
    history = history.slice(-10);
    busy = true;
    renderChat();
    if (input) input.value = '';

    try {
      const response = await fetch('/api/interventions/screen-help', {
        method:'POST',
        cache:'no-store',
        headers:{
          'Content-Type':'application/json',
          'x-session-token':token
        },
        body:JSON.stringify({
          task:taskForScreen(),
          message,
          screenContext,
          history:history.slice(0,-1).slice(-8)
        }),
        signal:AbortSignal.timeout(50000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The AI Assistant could not respond.');
      history.push({role:'assistant',text:data.reply || 'I could not generate feedback for this screen.'});
      history = history.slice(-10);
    } catch (error) {
      history.push({role:'assistant',text:error.message || 'The AI Assistant could not respond. Please try again.'});
      history = history.slice(-10);
    } finally {
      busy = false;
      refreshContextLabel();
      renderChat();
    }
  }

  function syncVisibility() {
    if (!root) return;
    const show = shouldShow();
    root.hidden = !show;
    if (!show) togglePanel(false);
    else resetForNewScreen();
  }

  function mount() {
    if (document.getElementById('personalAiAssistant')) return;

    root = document.createElement('aside');
    root.id = 'personalAiAssistant';
    root.className = 'personal-ai-assistant';
    root.setAttribute('aria-label','AI study assistant');
    root.innerHTML = [
      '<section class="personal-ai-panel" id="personalAiPanel" aria-hidden="true">',
        '<header class="personal-ai-panel-head">',
          '<div class="personal-ai-head-copy">',
            '<div class="personal-ai-brand-row"><span class="personal-ai-live-dot" aria-hidden="true"></span><strong>AI Assistant</strong></div>',
            '<span class="personal-ai-context-detail">Reading this page</span>',
            '<b class="personal-ai-context-label">Current PTE screen</b>',
          '</div>',
          '<button type="button" class="personal-ai-close" aria-label="Close AI Assistant">×</button>',
        '</header>',
        '<div class="personal-ai-chat" aria-live="polite"></div>',
        '<form class="personal-ai-composer">',
          '<textarea rows="2" aria-label="Ask the AI Assistant about this screen" placeholder="Ask about what is on this screen…"></textarea>',
          '<button type="submit" aria-label="Send message">Send</button>',
        '</form>',
        '<p class="personal-ai-footnote">Uses the visible practice page and your typed response. Hidden content and audio are not read.</p>',
      '</section>',
      '<button type="button" class="personal-ai-launcher" aria-label="Open AI Assistant" title="Open AI Assistant" aria-controls="personalAiPanel" aria-expanded="false">',
        '<img class="personal-ai-mascot-art" src="/assets/personal-ai-assistant.png?v=5" alt="">',
      '</button>'
    ].join('');

    document.body.appendChild(root);
    launcher = root.querySelector('.personal-ai-launcher');
    panel = root.querySelector('.personal-ai-panel');
    chat = root.querySelector('.personal-ai-chat');
    form = root.querySelector('.personal-ai-composer');
    input = form?.querySelector('textarea');
    contextLabel = root.querySelector('.personal-ai-context-label');
    contextDetail = root.querySelector('.personal-ai-context-detail');

    launcher?.addEventListener('click', () => togglePanel());
    root.querySelector('.personal-ai-close')?.addEventListener('click', () => togglePanel(false));
    chat?.addEventListener('click', event => {
      const quick = event.target.closest('[data-ai-quick]');
      if (quick) sendMessage(quick.dataset.aiQuick || '');
    });
    form?.addEventListener('submit', event => {
      event.preventDefault();
      sendMessage(input?.value || '');
    });
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });

    document.addEventListener('selectionchange', captureSelection);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root?.classList.contains('is-open')) {
        togglePanel(false);
        launcher?.focus();
      }
    });

    lastSection = currentSection();
    refreshContextLabel();
    renderChat();
    syncVisibility();

    const shell = document.getElementById('appShell');
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body,{attributes:true,attributeFilter:['data-section','class','style']});
    if (shell) observer.observe(shell,{attributes:true,attributeFilter:['class','style','hidden']});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',mount,{once:true});
  } else {
    mount();
  }
})();
