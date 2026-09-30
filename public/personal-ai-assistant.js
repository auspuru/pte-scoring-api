(() => {
  'use strict';

  const HIDDEN_SECTIONS = new Set(['mock-tests','writing-mocks','writing-run','writing-history','reading']);
  const SECTION_TASK = {
    swt:'swt',
    practice:'essay',
    'spoken-text':'sst',
    'speaking-ra':'ra',
    'speaking-rs':'rs',
    'speaking-di':'di',
    'speaking-rl':'rl',
    'speaking-sgd':'sgd',
    'speaking-rts':'rts'
  };
  const QUICK_PROMPTS = [
    'Give me feedback on what is on the screen.',
    'What is the main thing I should improve?',
    'Explain this question in simple English.',
    'Why might I be losing marks here?'
  ];

  let root = null;
  let launcher = null;
  let panel = null;
  let messages = [];
  let busy = false;
  let activeContextKey = '';
  let contextVersion = 0;
  let requestController = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function authToken() {
    try {
      const impersonation = sessionStorage.getItem('pte_impersonate_token');
      if (impersonation) return impersonation;
      const session = sessionStorage.getItem('pte_session_token');
      if (session) return session;
    } catch (_) {}
    try { return localStorage.getItem('pte_session_token') || ''; }
    catch (_) { return ''; }
  }

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
    return appIsVisible() && !HIDDEN_SECTIONS.has(currentSection());
  }

  function syncVisibility() {
    if (!root) return;
    root.hidden = !shouldShow();
    if (root.hidden) closePanel(false);
  }

  function visible(element) {
    if (!element || element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function currentPageRoot() {
    const activePane = [...document.querySelectorAll('.pane')].find(node => !node.hidden && visible(node));
    return activePane || document.getElementById('portalContent') || document.body;
  }

  function pageTitle() {
    return document.getElementById('pageTitle')?.textContent?.trim()
      || document.title.replace(/\s*·\s*IPT Brisbane.*$/i,'').trim()
      || 'Current page';
  }

  function cleanText(value, max = 10000) {
    return String(value || '').replace(/\s+/g,' ').trim().slice(0,max);
  }

  function selectedText() {
    try { return cleanText(window.getSelection?.().toString(), 2500); }
    catch (_) { return ''; }
  }

  function collectFieldValues(rootNode) {
    const rows = [];
    const fields = rootNode.querySelectorAll?.('textarea,input,[contenteditable="true"]') || [];
    for (const field of fields) {
      if (!visible(field)) continue;
      const type = String(field.getAttribute?.('type') || '').toLowerCase();
      if (['password','hidden','email','tel'].includes(type)) continue;
      let value = field.matches?.('[contenteditable="true"]') ? field.textContent : field.value;
      value = cleanText(value, 3500);
      if (!value) continue;
      const id = field.id;
      const label = (id && document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent)
        || field.getAttribute?.('aria-label')
        || field.getAttribute?.('placeholder')
        || field.name
        || 'Student response';
      rows.push(cleanText(label,120) + ': ' + value);
      if (rows.join('\n').length > 6500) break;
    }
    return rows;
  }

  function collectImageNotes(rootNode) {
    const rows = [];
    const images = rootNode.querySelectorAll?.('img') || [];
    for (const img of images) {
      if (!visible(img)) continue;
      const alt = cleanText(img.alt || img.title, 300);
      if (alt) rows.push('Visible image description: ' + alt);
      if (rows.length >= 4) break;
    }
    return rows;
  }

  function screenContext(usePage = true) {
    const section = currentSection();
    const title = pageTitle();
    if (!usePage) return 'Page context sharing is off. Current page title: ' + title + '.';
    const rootNode = currentPageRoot();
    const selection = selectedText();
    let visibleText = cleanText(rootNode.innerText || rootNode.textContent, 8500);
    const fields = collectFieldValues(rootNode);
    const images = collectImageNotes(rootNode);
    const parts = [
      'Current portal page: ' + title,
      'Portal section: ' + section,
      selection ? 'Student-selected text: ' + selection : '',
      visibleText ? 'Visible page content: ' + visibleText : '',
      fields.length ? 'Student-entered content:\n' + fields.join('\n') : '',
      images.length ? images.join('\n') : ''
    ].filter(Boolean);
    return parts.join('\n\n').slice(0,12000);
  }

  function taskFromScreen() {
    return SECTION_TASK[currentSection()] || 'portal';
  }

  function screenIdentity() {
    const rootNode = currentPageRoot();
    const identifiers = [];
    const selectors = [
      '[data-question-id]','[data-passage-id]','[data-practice-uid]',
      '[data-attempt-id]','[data-test-id]','[data-item-id]'
    ];
    for (const selector of selectors) {
      const node = rootNode.querySelector?.(selector);
      if (!node || !visible(node)) continue;
      const entry = [...(node.attributes || [])].find(attr => /^data-(?:question|passage|practice|attempt|test|item)-id$/.test(attr.name));
      if (entry?.value) identifiers.push(entry.name + '=' + entry.value);
    }
    const heading = cleanText(rootNode.querySelector?.('h1,h2,h3,legend,[data-question-title]')?.textContent, 220);
    const visibleText = cleanText(rootNode.innerText || rootNode.textContent, 900);
    return [
      currentSection(),
      pageTitle(),
      identifiers.join('|'),
      heading,
      visibleText.slice(0,650)
    ].join('||');
  }

  function cancelRequest() {
    if (requestController) requestController.abort();
    requestController = null;
  }

  function refreshScreenContext(force = false) {
    const nextKey = screenIdentity();
    if (!activeContextKey) {
      activeContextKey = nextKey;
      return false;
    }
    if (!force && nextKey === activeContextKey) return false;
    activeContextKey = nextKey;
    contextVersion += 1;
    cancelRequest();
    if (busy) setBusy(false);
    messages = [];
    renderMessages();
    updateContextBadge();
    return true;
  }

  function formatReply(value) {
    const safe = esc(value)
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g,'<em>$1</em>');
    const lines = safe.split(/\r?\n/).map(line => line.trim());
    let html = '', list = [];
    const flush = () => {
      if (!list.length) return;
      html += '<ul>' + list.map(item => '<li>' + item + '</li>').join('') + '</ul>';
      list = [];
    };
    for (const line of lines) {
      if (!line) { flush(); continue; }
      const bullet = line.match(/^(?:[-•]|\d+[.)])\s+(.+)/);
      if (bullet) { list.push(bullet[1]); continue; }
      const heading = line.match(/^#{1,4}\s+(.+)/);
      flush();
      html += '<p>' + (heading ? '<strong>'+heading[1]+'</strong>' : line) + '</p>';
    }
    flush();
    return html || '<p></p>';
  }

  function renderMessages() {
    const host = root?.querySelector('[data-ai-messages]');
    if (!host) return;
    if (!messages.length) {
      host.innerHTML = '<div class="personal-ai-welcome"><span class="personal-ai-spark" aria-hidden="true">✦</span><div><strong>I can read this practice page.</strong><p>Ask about the question, your response, feedback or score without copying it into chat.</p></div></div>'
        + '<div class="personal-ai-quick">' + QUICK_PROMPTS.map(prompt => '<button type="button" data-ai-quick="'+esc(prompt)+'">'+esc(prompt)+'</button>').join('') + '</div>';
      return;
    }
    host.innerHTML = messages.map(message => '<article class="personal-ai-message '+message.role+'"><span>'+ (message.role === 'assistant' ? 'AI Assistant' : 'You') +'</span><div>'+ (message.role === 'assistant' ? formatReply(message.text) : '<p>'+esc(message.text)+'</p>') +'</div></article>').join('');
    host.scrollTop = host.scrollHeight;
  }

  function updateContextBadge() {
    const badge = root?.querySelector('[data-ai-context]');
    const page = root?.querySelector('[data-ai-page]');
    const share = root?.querySelector('[data-ai-share]');
    if (page) page.textContent = pageTitle();
    if (!badge) return;
    const selection = selectedText();
    badge.textContent = share?.checked === false ? 'Page context off' : selection ? 'Reading selected text + page' : 'Reading this page';
    badge.classList.toggle('is-off', share?.checked === false);
  }

  function setBusy(next) {
    busy = next;
    const send = root?.querySelector('[data-ai-send]');
    const input = root?.querySelector('[data-ai-input]');
    if (send) {
      send.disabled = next;
      send.textContent = next ? 'Thinking…' : 'Send';
    }
    if (input) input.disabled = next;
  }

  async function ask(message) {
    const text = cleanText(message, 4000);
    refreshScreenContext();
    if (!text || busy) return;
    const input = root?.querySelector('[data-ai-input]');
    const share = root?.querySelector('[data-ai-share]');
    const token = authToken();
    if (!token) {
      messages.push({role:'assistant',text:'Please sign in again so I can read your current practice context.'});
      renderMessages();
      return;
    }

    const requestKey = activeContextKey || screenIdentity();
    const requestVersion = contextVersion;
    const requestTask = taskFromScreen();
    const requestContext = screenContext(share?.checked !== false);
    const requestHistory = messages.slice(-8);

    messages.push({role:'user',text});
    renderMessages();
    if (input) input.value = '';
    setBusy(true);

    const controller = new AbortController();
    requestController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 50000);
    try {
      const response = await fetch('/api/interventions/screen-help', {
        method:'POST',
        cache:'no-store',
        headers:{'Content-Type':'application/json','x-session-token':token},
        body:JSON.stringify({
          task:requestTask,
          message:text,
          history:requestHistory,
          screenContext:requestContext
        }),
        signal:controller.signal
      });
      const data = await response.json().catch(()=>({}));
      if (requestVersion !== contextVersion || requestKey !== activeContextKey) return;
      if (!response.ok) throw new Error(data.error || 'The AI Assistant could not answer right now.');
      messages.push({role:'assistant',text:data.reply || 'I could not generate feedback for this screen.'});
    } catch (error) {
      if (requestVersion !== contextVersion || requestKey !== activeContextKey) return;
      if (error?.name === 'AbortError') {
        messages.push({role:'assistant',text:'That request took too long. Please try again on this screen.'});
      } else {
        messages.push({role:'assistant',text:error.message || 'The AI Assistant could not answer right now.'});
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestController === controller) {
        requestController = null;
        setBusy(false);
        renderMessages();
        updateContextBadge();
        input?.focus();
      }
    }
  }

  function openPanel() {
    if (!root || root.hidden) return;
    root.classList.add('is-open');
    launcher?.setAttribute('aria-expanded','true');
    panel?.setAttribute('aria-hidden','false');
    launcher?.classList.remove('is-waving');
    void launcher?.offsetWidth;
    launcher?.classList.add('is-waving');
    window.setTimeout(() => launcher?.classList.remove('is-waving'), 900);
    updateContextBadge();
    renderMessages();
    window.setTimeout(() => root?.querySelector('[data-ai-input]')?.focus(), 120);
  }

  function closePanel(restoreFocus = true) {
    if (!root) return;
    root.classList.remove('is-open');
    launcher?.setAttribute('aria-expanded','false');
    panel?.setAttribute('aria-hidden','true');
    if (restoreFocus) launcher?.focus();
  }

  function newChat() {
    cancelRequest();
    contextVersion += 1;
    activeContextKey = screenIdentity();
    messages = [];
    if (busy) setBusy(false);
    renderMessages();
    updateContextBadge();
    root?.querySelector('[data-ai-input]')?.focus();
  }

  function mount() {
    if (document.getElementById('personalAiAssistant')) return;
    root = document.createElement('aside');
    root.id = 'personalAiAssistant';
    root.className = 'personal-ai-assistant';
    root.setAttribute('aria-label','AI Assistant');
    root.innerHTML = [
      '<section class="personal-ai-panel" aria-hidden="true" aria-label="AI Assistant chat">',
        '<header class="personal-ai-panel-head">',
          '<div class="personal-ai-heading">',
            '<span class="personal-ai-kicker">IPT AI Assistant</span>',
            '<strong data-ai-page>Current page</strong>',
          '</div>',
          '<div class="personal-ai-head-actions">',
            '<button type="button" class="personal-ai-icon-button" data-ai-new title="New chat" aria-label="Start new chat">↻</button>',
            '<button type="button" class="personal-ai-close-button" data-ai-close aria-label="Close AI Assistant"><span aria-hidden="true">×</span> Close</button>',
          '</div>',
        '</header>',
        '<div class="personal-ai-context-row">',
          '<span class="personal-ai-context-badge" data-ai-context>Reading this page</span>',
          '<label class="personal-ai-share"><input type="checkbox" data-ai-share checked> Use page context</label>',
        '</div>',
        '<div class="personal-ai-messages" data-ai-messages aria-live="polite"></div>',
        '<form class="personal-ai-composer" data-ai-form>',
          '<textarea data-ai-input rows="2" aria-label="Ask about this page" placeholder="Ask about what is on this screen…"></textarea>',
          '<button type="submit" data-ai-send>Send</button>',
        '</form>',
        '<p class="personal-ai-footnote">Uses the current portal page as context. Your selected text is prioritised automatically.</p>',
      '</section>',
      '<button type="button" class="personal-ai-launcher" aria-label="Open AI Assistant" title="Open AI Assistant" aria-expanded="false">',
        '<img class="personal-ai-mascot-art" src="/assets/personal-ai-assistant-exact.webp?v=6" alt="">',
      '</button>'
    ].join('');

    document.body.appendChild(root);
    launcher = root.querySelector('.personal-ai-launcher');
    panel = root.querySelector('.personal-ai-panel');

    launcher?.addEventListener('click', () => root.classList.contains('is-open') ? closePanel() : openPanel());
    root.querySelector('[data-ai-close]')?.addEventListener('click', () => closePanel());
    root.querySelector('[data-ai-new]')?.addEventListener('click', newChat);
    root.querySelector('[data-ai-share]')?.addEventListener('change', updateContextBadge);
    root.querySelector('[data-ai-form]')?.addEventListener('submit', event => {
      event.preventDefault();
      ask(root.querySelector('[data-ai-input]')?.value);
    });
    root.addEventListener('click', event => {
      const quick = event.target.closest('[data-ai-quick]');
      if (quick) ask(quick.dataset.aiQuick);
    });
    document.addEventListener('selectionchange', () => {
      if (root?.classList.contains('is-open')) updateContextBadge();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root?.classList.contains('is-open')) closePanel();
    });

    syncVisibility();
    activeContextKey = screenIdentity();
    renderMessages();
    updateContextBadge();

    const shell = document.getElementById('appShell');
    const observer = new MutationObserver(() => {
      syncVisibility();
      refreshScreenContext();
      if (root?.classList.contains('is-open')) updateContextBadge();
    });
    observer.observe(document.body,{attributes:true,attributeFilter:['data-section','class','style']});
    if (shell) observer.observe(shell,{attributes:true,attributeFilter:['class','style','hidden']});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
