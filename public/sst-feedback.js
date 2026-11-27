(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SstFeedback = factory(root.document);
})(globalThis, function (document) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
  const labels = Object.freeze({ covered:'Covered', partial:'Partly covered', missed:'Missed' });

  function render({ ideas, nextStep, response } = {}) {
    if (!Array.isArray(ideas) || !ideas.length) return '';
    const list = ideas.map(({ main, supporting, status, evidence }) => {
      const label = Object.hasOwn(labels, status) ? '<span class="sst-idea-status">' + labels[status] + '</span>' : '';
      const details = Array.isArray(supporting) && supporting.length
        ? '<ul>' + supporting.map(detail => '<li>' + escape(detail) + '</li>').join('') + '</ul>' : '';
      const quote = evidence && label ? '<blockquote>' + escape(evidence) + '</blockquote>' : '';
      return '<li><strong>' + escape(main) + '</strong>' + label + details + quote + '</li>';
    }).join('');
    const fullscreen = document?.fullscreenEnabled ? '<button type="button" class="secondary" data-sst-fullscreen>Full screen</button>' : '';
    const answer = typeof response === 'string' ? '<h4>Your response</h4><p>' + escape(response || 'No answer submitted.') + '</p>' : '';
    return '<section class="sst-idea-feedback"><div class="sst-idea-header"><h4>Key ideas from the transcript</h4>' + fullscreen + '</div>'
      + answer + (nextStep ? '<p><strong>Next step</strong> ' + escape(nextStep) + '</p>' : '')
      + '<p>Cover ' + (ideas.length === 1 ? 'the bold idea' : 'the bold ideas') + ' in your own words. Add a supporting detail when it helps explain an idea.</p>'
      + '<ul class="sst-idea-list">' + list + '</ul></section>';
  }

  document?.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-sst-fullscreen]');
    if (!button) return;
    try {
      const panel = button.closest('.sst-idea-feedback');
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch {
      button.hidden = true;
    }
  });
  document?.addEventListener('fullscreenchange', () => {
    for (const button of document.querySelectorAll('[data-sst-fullscreen]')) {
      button.textContent = button.closest('.sst-idea-feedback') === document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    }
  });
  return Object.freeze({ render });
});
