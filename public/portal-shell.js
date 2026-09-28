'use strict';
(function () {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
  const canAnimate = () => !(reduceMotion && reduceMotion.matches);

  function setMotionClass() {
    document.body.classList.toggle('ipt-glass-motion', canAnimate() && (!finePointer || finePointer.matches));
  }

  function installSpecular(surface) {
    if (!surface || surface.dataset.iptSpecularReady === '1') return;
    surface.dataset.iptSpecularReady = '1';
    surface.addEventListener('pointermove', event => {
      if (!canAnimate() || (finePointer && !finePointer.matches)) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty('--ipt-glass-x', (event.clientX - rect.left) + 'px');
      surface.style.setProperty('--ipt-glass-y', (event.clientY - rect.top) + 'px');
    }, { passive: true });
  }

  function installGlassSurfaces() {
    document.querySelectorAll('#portalSidebar, .topbar, .login-card, .modal').forEach(installSpecular);
  }

  function installNavIndicator() {
    const menu = document.querySelector('#portalSidebar .sidebar-menu');
    if (!menu) return;

    let indicator = menu.querySelector('.ipt-nav-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'ipt-nav-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      menu.prepend(indicator);
    }

    const items = [...menu.querySelectorAll('.nav-item')];
    const update = () => {
      const active = items.find(item => item.classList.contains('active') && !item.hidden && getComputedStyle(item).display !== 'none');
      if (!active) {
        indicator.style.opacity = '0';
        return;
      }
      const menuRect = menu.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      indicator.style.setProperty('--ipt-nav-y', (activeRect.top - menuRect.top) + 'px');
      indicator.style.setProperty('--ipt-nav-h', activeRect.height + 'px');
      indicator.style.opacity = '1';
    };

    items.forEach(item => new MutationObserver(update).observe(item, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'aria-current']
    }));

    window.addEventListener('resize', update, { passive: true });
    requestAnimationFrame(update);
  }

  function installPressPhysics() {
    const selector = '.nav-item, .portal-button, .tb-text-btn, .portal-menu-toggle, .user-badge, .login-submit, .home-skill-card, .practice-banner button';
    document.addEventListener('pointerdown', event => {
      const control = event.target.closest(selector);
      if (!control || control.disabled || !canAnimate()) return;
      control.classList.add('ipt-pressed');
    });
    const release = event => {
      const control = event.target.closest && event.target.closest(selector);
      if (control) control.classList.remove('ipt-pressed');
      document.querySelectorAll('.ipt-pressed').forEach(node => node.classList.remove('ipt-pressed'));
    };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('pointerleave', release);
  }

  function installPageTransitions() {
    if (!('MutationObserver' in window)) return;
    const container = document.getElementById('portalContent');
    if (!container) return;

    const animatePane = pane => {
      if (!canAnimate() || pane.hidden || !pane.classList.contains('active') || typeof pane.animate !== 'function') return;
      pane.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.992)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
      ], {
        duration: 300,
        easing: 'cubic-bezier(.22,.8,.2,1)'
      });
    };

    const lastAnimation = new WeakMap();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (!record.target.classList || !record.target.classList.contains('pane')) continue;
        const now = performance.now();
        const previous = lastAnimation.get(record.target) || 0;
        if (now - previous < 80) continue;
        lastAnimation.set(record.target, now);
        animatePane(record.target);
      }
    });

    container.querySelectorAll('.pane').forEach(pane => {
      observer.observe(pane, { attributes: true, attributeFilter: ['class', 'hidden'] });
    });
  }

  function installCardTilt() {
    const cards = [...document.querySelectorAll('#dashboardPane .portal-task, #dashboardPane .home-skill-card')];
    cards.forEach(card => {
      card.dataset.iptTilt = '1';
      card.addEventListener('pointermove', event => {
        if (!canAnimate() || (finePointer && !finePointer.matches)) return;
        const rect = card.getBoundingClientRect();
        const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        card.style.setProperty('--ipt-tilt-y', ((px - .5) * 2.2) + 'deg');
        card.style.setProperty('--ipt-tilt-x', ((.5 - py) * 1.7) + 'deg');
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--ipt-tilt-x');
        card.style.removeProperty('--ipt-tilt-y');
      }, { passive: true });
    });
  }

  function start() {
    document.body.dataset.iptShellReady = 'true';
    setMotionClass();
    installGlassSurfaces();
    installNavIndicator();
    installPressPhysics();
    installPageTransitions();
    installCardTilt();

    if (reduceMotion && reduceMotion.addEventListener) reduceMotion.addEventListener('change', setMotionClass);
    if (finePointer && finePointer.addEventListener) finePointer.addEventListener('change', setMotionClass);

    new MutationObserver(installGlassSurfaces).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
