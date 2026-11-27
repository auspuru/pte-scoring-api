(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SstFeedback = factory(root.document);
})(globalThis, function (document) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
  const labels = Object.freeze({ covered:'Covered', partial:'Partly covered', missed:'Missed' });
  const traits = Object.freeze({ content:'Content', form:'Form', grammar:'Grammar', vocabulary:'Vocabulary', spelling:'Spelling' });
  const targets = {
    content:'Summarise the main ideas accurately and show how they relate.',
    form:'Write 50–70 words. Multiple sentences are allowed.',
    grammar:'Use complete sentences and accurate structures.',
    vocabulary:'Choose words that fit the meaning and context.',
    spelling:'Check the spelling of your words.'
  };

  function transcriptHighlights(transcript, highlights, ideas) {
    const ranges = ideas.flatMap((_, index) =>
      (Array.isArray(highlights?.[index]) ? highlights[index] : [])
        .filter(quote => typeof quote === 'string' && quote.trim())
        .map(quote => ({ index, start:transcript.indexOf(quote), length:quote.length }))
        .filter(range => range.start >= 0));
    const linked = new Set();
    let cursor = 0, html = '';
    for (const { index, start, length } of ranges.sort((a,b) => a.start-b.start || b.length-a.length)) {
      if (start < cursor) continue;
      html += escape(transcript.slice(cursor,start)) + '<mark tabindex="-1" data-sst-idea="' + index + '">' + escape(transcript.slice(start,start+length)) + '</mark>';
      cursor = start+length;
      linked.add(index);
    }
    return { html:html + escape(transcript.slice(cursor)), linked };
  }

  function scoreReport(scores, maxima, total, maximum, feedback) {
    const valid = (score, max) => Number.isFinite(max) && max > 0 && Number.isFinite(score) && score >= 0 && score <= max;
    const mark = (label, score, max) => '<div><dt>' + label + '</dt><dd>'
      + (valid(score,max) ? escape(score) + ' / ' + escape(max) : '—') + '</dd></div>';
    const breakdown = feedback && Object.entries(traits).map(([key,label]) => {
      const note = feedback[key];
      return '<div><dt>' + label + '</dt><dd>' + (note ? '<p>' + escape(note) + '</p>' : '')
        + '<p><strong>For full marks</strong> ' + targets[key] + '</p></dd></div>';
    }).join('');
    return '<div class="sst-score-report"><dl class="sst-score-strip">' + mark('Total score',total,maximum)
      + Object.entries(traits).map(([key,label])=>mark(label,scores?.[key],maxima?.[key])).join('') + '</dl>'
      + (breakdown ? '<details class="sst-marking"><summary>Marking details</summary><dl>' + breakdown + '</dl></details>' : '') + '</div>';
  }

  function render({ ideas = [], nextStep, response, transcript = '', scores, maxima, total, maximum, criterionFeedback, status, recordingHtml, highlights } = {}) {
    if (!Array.isArray(ideas)) ideas = [];
    if (!ideas.length && !transcript && typeof response !== 'string') return '';
    const { html, linked } = transcriptHighlights(transcript, highlights, ideas);
    const list = ideas.map(({ main, supporting, status:coverage, evidence }, index) => {
      const label = Object.hasOwn(labels, coverage) ? '<span class="sst-idea-status ' + coverage + '">' + labels[coverage] + '</span>' : '';
      const details = Array.isArray(supporting) && supporting.length
        ? '<ul>' + supporting.map(detail => '<li>'+escape(detail)+'</li>').join('') + '</ul>' : '';
      const validEvidence = typeof evidence === 'string' && evidence.trim() && typeof response === 'string' && response.includes(evidence);
      const quote = validEvidence && label ? '<blockquote>' + escape(evidence) + '</blockquote>' : '';
      const gap = coverage === 'missed' ? 'Add this main idea in your own words.'
        : coverage === 'partial' ? 'Explain this point more fully using the transcript.' : '';
      const jump = linked.has(index) ? '<button class="secondary" type="button" data-sst-passage="' + index + '" aria-label="Show in transcript: ' + escape(main) + '">Show in transcript</button>' : '';
      return '<li><div class="sst-idea-line"><strong>' + escape(main) + '</strong>' + label + '</div>'
        + (gap ? '<p>' + gap + '</p>' : '') + (jump || details || quote ? '<div class="sst-idea-actions">' + jump
          + (details || quote ? '<details><summary>' + (quote ? 'Response evidence' : 'Supporting detail') + '</summary>' + details + quote + '</details>' : '')
          + '</div>' : '') + '</li>';
    }).join('');
    const revisionHeading = ideas.some(idea => idea.status === 'missed' || idea.status === 'partial') ? 'What’s missing' : 'Next step';
    const fullscreen = document?.fullscreenEnabled ? '<button type="button" class="secondary" data-sst-fullscreen>Full screen</button>' : '';
    const answer = typeof response === 'string' ? '<h4>Your response</h4><div class="sst-saved-summary" tabindex="0" role="region" aria-label="Saved summary">'
      + escape(response || 'No answer submitted.') + '</div>' : '';
    const recording = transcript || recordingHtml ? '<div class="sst-transcript"><h4>Recording transcript</h4>' + (recordingHtml || '')
      + (transcript ? '<div class="sst-transcript-text" role="region" aria-label="Full transcript" tabindex="0">' + html + '</div>' : '') + '</div>' : '';
    return '<section class="sst-idea-feedback" aria-label="Summarise Spoken Text review"><div class="sst-idea-header"><h4>Summarise Spoken Text review</h4>' + fullscreen + '</div>'
      + scoreReport(scores,maxima,total,maximum,criterionFeedback)
      + (status ? '<p class="sst-coverage-notice" role="status">' + escape(status) + '</p>' : '')
      + '<div class="sst-review-grid' + (recording ? ' has-transcript' : '') + '">' + recording + '<div class="sst-response-feedback">'
      + answer + (nextStep ? '<section class="sst-next-step"><h4>' + revisionHeading + '</h4><p>' + escape(nextStep) + '</p></section>' : '')
      + (list ? '<h4>Key ideas from the transcript</h4><ul class="sst-idea-list">' + list + '</ul>' : '') + '</div></div></section>';
  }

  document?.addEventListener('click', async event => {
    const jump = event.target.closest?.('[data-sst-passage]');
    if (jump) {
      const panel = jump.closest('.sst-idea-feedback');
      const scroller = panel.querySelector('.sst-transcript-text');
      const target = scroller?.querySelector('[data-sst-idea="' + jump.dataset.sstPassage + '"]');
      if (!target) return;
      scroller.querySelector('.sst-highlight-active')?.classList.remove('sst-highlight-active');
      target.classList.add('sst-highlight-active');
      target.focus({preventScroll:true});
      scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      return;
    }
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
