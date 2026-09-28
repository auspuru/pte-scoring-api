(() => {
  const emojis = Array.from(document.querySelectorAll('.ipt-emoji'));
  if (!emojis.length) return;

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const setPressed = (el, pressed) => el.classList.toggle('is-pressed', pressed);

  emojis.forEach((el) => {
    if (finePointer && !reducedMotion) {
      el.addEventListener('pointermove', (event) => {
        const rect = el.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        el.style.setProperty('--emoji-glass-x', x.toFixed(1) + '%');
        el.style.setProperty('--emoji-glass-y', y.toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--emoji-glass-x', '32%');
        el.style.setProperty('--emoji-glass-y', '18%');
      });
    }

    el.addEventListener('pointerdown', () => setPressed(el, true));
    el.addEventListener('pointerup', () => setPressed(el, false));
    el.addEventListener('pointercancel', () => setPressed(el, false));
    el.addEventListener('pointerleave', () => setPressed(el, false));
  });

  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-paused', !entry.isIntersecting);
      });
    }, { rootMargin: '120px' });
    emojis.forEach((el) => observer.observe(el));
  }
})();
