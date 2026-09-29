'use strict';

(function () {
  const writingSections = new Set(['practice', 'swt']);
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  const writingActive = () => writingSections.has(document.body.dataset.section || '');

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
    if (!writingActive()) return;
    installEssayObserver();
    installSwtObserver();
    if (document.body.dataset.section === 'practice') requestAnimationFrame(animateEssayView);
    if (document.body.dataset.section === 'swt') {
      const screen = document.querySelector('#swtPane .swt-sub-screen.active');
      if (screen) animateNode(screen, { y: 8, duration: 300 });
    }
  }

  function start() {
    new MutationObserver(updateSection).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-section']
    });

    if (reducedMotion && reducedMotion.addEventListener) reducedMotion.addEventListener('change', updateSection);
    updateSection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
