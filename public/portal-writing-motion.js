'use strict';

(function () {
  const writingSections = new Set(['practice', 'swt']);
  const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  let dot;
  let halo;
  let frame = 0;
  let visible = false;
  let targetX = innerWidth / 2;
  let targetY = innerHeight / 2;
  let haloX = targetX;
  let haloY = targetY;

  const writingActive = () => writingSections.has(document.body.dataset.section || '');
  const canUseCursor = () => writingActive()
    && (!finePointer || finePointer.matches)
    && !(reducedMotion && reducedMotion.matches);

  function ensureCursor() {
    if (dot && halo) return;
    dot = document.createElement('span');
    halo = document.createElement('span');
    dot.className = 'ipt-writing-cursor-dot';
    halo.className = 'ipt-writing-cursor-halo';
    dot.setAttribute('aria-hidden', 'true');
    halo.setAttribute('aria-hidden', 'true');
    document.body.append(dot, halo);
  }

  function position(node, x, y) {
    if (!node) return;
    node.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }

  function renderCursor() {
    frame = 0;
    if (!canUseCursor()) {
      document.body.classList.remove('ipt-writing-cursor-enabled');
      visible = false;
      return;
    }
    haloX += (targetX - haloX) * .18;
    haloY += (targetY - haloY) * .18;
    position(dot, targetX, targetY);
    position(halo, haloX, haloY);
    if (visible) document.body.classList.add('ipt-writing-cursor-enabled');
    if (Math.abs(targetX - haloX) > .15 || Math.abs(targetY - haloY) > .15) schedule();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(renderCursor);
  }

  function setPointerState(target) {
    if (!dot || !halo) return;
    const text = target.closest('textarea,input,[contenteditable="true"],select');
    const disabled = target.closest(':disabled,[aria-disabled="true"]');
    const primary = target.closest(
      '.practice-action-btn.primary,#practiceSubmitBtn,.practice-welcome-cta,.write-actions .primary,[data-submit]'
    );
    const action = target.closest(
      'button,a,[role="button"],summary,.practice-question-item,.practice-history-item,.practice-history-group-header,label'
    );
    for (const node of [dot, halo]) {
      node.classList.toggle('is-text', !!text);
      node.classList.toggle('is-disabled', !!disabled);
    }
    halo.classList.toggle('is-primary', !!primary);
    halo.classList.toggle('is-action', !!action && !primary && !text);
  }

  function onPointerMove(event) {
    if (!canUseCursor()) return;
    ensureCursor();
    targetX = event.clientX;
    targetY = event.clientY;
    if (!visible) {
      haloX = targetX;
      haloY = targetY;
      visible = true;
    }
    setPointerState(event.target);
    schedule();
  }

  function hideCursor() {
    visible = false;
    document.body.classList.remove('ipt-writing-cursor-enabled');
  }

  function pressCursor(on) {
    if (!canUseCursor() || !halo) return;
    halo.classList.toggle('is-down', on);
  }

  function animateNode(node, options = {}) {
    if (!node || !writingActive() || (reducedMotion && reducedMotion.matches) || typeof node.animate !== 'function') return;
    node.animate([
      { opacity: 0, transform: 'translateY(' + (options.y || 10) + 'px) scale(.992)', filter: 'blur(3px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
    ], {
      duration: options.duration || 320,
      easing: 'cubic-bezier(.22,.8,.2,1)',
      fill: 'both'
    });
  }

  function animateEssayView() {
    if (document.body.dataset.section !== 'practice') return;
    const content = document.getElementById('practiceContent');
    if (!content) return;
    content.dataset.iptWritingView = content.dataset.view || '';
    const main = content.firstElementChild;
    if (main) animateNode(main, { y: 12, duration: 340 });
    const nav = document.getElementById('essayQuestionNav');
    if (nav && nav.firstElementChild) animateNode(nav.firstElementChild, { y: 6, duration: 280 });
  }

  function installEssayObserver() {
    const content = document.getElementById('practiceContent');
    if (!content || content.dataset.iptMotionReady === '1') return;
    content.dataset.iptMotionReady = '1';
    new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) requestAnimationFrame(animateEssayView);
    }).observe(content, { childList: true });
  }

  function installSwtObserver() {
    const pane = document.getElementById('swtPane');
    if (!pane || pane.dataset.iptMotionReady === '1') return;
    pane.dataset.iptMotionReady = '1';
    const observer = new MutationObserver(records => {
      if (document.body.dataset.section !== 'swt') return;
      const candidate = records.map(record => record.target)
        .find(node => node.classList && node.classList.contains('swt-sub-screen') && node.classList.contains('active'));
      if (candidate) animateNode(candidate, { y: 8, duration: 300 });
    });
    pane.querySelectorAll('.swt-sub-screen').forEach(node => observer.observe(node, {
      attributes: true,
      attributeFilter: ['class', 'hidden']
    }));
  }

  function updateSection() {
    const active = writingActive();
    if (!active) hideCursor();
    if (active) {
      installEssayObserver();
      installSwtObserver();
      if (document.body.dataset.section === 'practice') requestAnimationFrame(animateEssayView);
      if (document.body.dataset.section === 'swt') {
        const screen = document.querySelector('#swtPane .swt-sub-screen.active');
        if (screen) animateNode(screen, { y: 8, duration: 300 });
      }
    }
  }

  function start() {
    ensureCursor();
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', () => pressCursor(true), { passive: true });
    document.addEventListener('pointerup', () => pressCursor(false), { passive: true });
    document.addEventListener('pointercancel', () => pressCursor(false), { passive: true });
    document.documentElement.addEventListener('mouseleave', hideCursor, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideCursor(); });

    new MutationObserver(updateSection).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-section']
    });

    if (finePointer && finePointer.addEventListener) finePointer.addEventListener('change', updateSection);
    if (reducedMotion && reducedMotion.addEventListener) reducedMotion.addEventListener('change', updateSection);

    updateSection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
