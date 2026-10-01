(function (root, factory) {
  const report = factory();
  if (typeof module === 'object' && module.exports) module.exports = report;
  else root.WritingLabReport = report;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const labels = { swt: 'Summarise Written Text', essay: 'Write Essay', sst: 'Summarise Spoken Text', wfd: 'Write from Dictation' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const provisional = result => !!result && (result.provisional === true || result.scoringMode === 'local');
  function sstCoverage(q, response, result) {
    return (Array.isArray(result?.coverage) ? result.coverage : []).filter(c =>
      c && (q.keyPoints || []).includes(c.point) && ['captured','missing','misunderstood'].includes(c.status)
      && typeof c.evidence === 'string' && (c.status === 'missing' ? c.evidence === '' : !!c.evidence.trim() && response.includes(c.evidence))
      && typeof c.transcriptEvidence === 'string' && c.transcriptEvidence && q.text.includes(c.transcriptEvidence));
  }
  function highlight(text, coverage, key) {
    const ranges = [];
    for (const c of coverage) {
      const quote = c[key];
      if (!quote) continue;
      const start = text.indexOf(quote), end = start + quote.length;
      if (start < 0 || ranges.some(r => start < r.end && end > r.start)) continue;
      ranges.push({start,end,status:c.status});
    }
    let html = '', cursor = 0;
    for (const r of ranges.sort((a,b) => a.start-b.start)) {
      html += esc(text.slice(cursor,r.start)) + '<mark class="sst-evidence-'+r.status+'">'+esc(text.slice(r.start,r.end))+'</mark>';
      cursor = r.end;
    }
    return html + esc(text.slice(cursor));
  }
  function sstReview(q, response, result) {
    const coverage = provisional(result) ? [] : sstCoverage(q,response,result);
    const issue = coverage.find(c => c.status === 'misunderstood') || coverage.find(c => c.status === 'missing');
    const next = provisional(result)
      ? 'Retry the assessment to get a meaning-based review before deciding what to practise.'
      : result?.gated ? (result.reasons || []).join(' ') + ' Revise your response to address this requirement, then start a fresh attempt.'
      : issue?.status === 'misunderstood'
        ? 'Replay the part about “'+issue.point+'”. Write who or what is involved and what happened. Revise that sentence without reversing the relationship.'
        : issue ? 'Replay the part about “'+issue.point+'”. Take one complete idea as a note, then connect it to your main topic in one sentence.'
        : result?.scores?.content < result?.maxima?.content
          ? 'Listen again. Note the main topic, two connected supporting ideas and the conclusion. Check which essential idea your summary leaves out.'
          : result?.scores?.grammar < result?.maxima?.grammar || result?.scores?.spelling < result?.maxima?.spelling
            ? 'Use the language corrections below. Rewrite the affected sentence, check verb forms and spelling, then submit a fresh attempt.'
            : result?.scores?.form < result?.maxima?.form
              ? 'Revise your summary to 50–70 words in connected sentences, keeping the main idea and essential support.'
              : result?.scores?.vocabulary < result?.maxima?.vocabulary
                ? 'Review the vocabulary feedback. Replace the imprecise phrase with wording that keeps the lecture’s original meaning.'
                : 'Keep this structure. Try another lecture and capture its main idea and connected support without copying the sample.';
    return '<section class="sst-next-step"><h3>Your next step</h3><p>'+esc(next)+'</p></section>'
      + '<section class="sst-comparison"><h3>Compare the lecture with your summary</h3><p class="muted">'+(coverage.length ? 'Green: captured · amber: missing · red: misunderstood. Highlights use checked quotations; paraphrases can still earn credit.' : 'No verified idea-by-idea review is available for this saved assessment. Compare the source and your response below; unhighlighted text does not mean an idea was missed.')+'</p>'
      + '<div class="sst-comparison-columns"><div><h4>Lecture transcript</h4><div class="response">'+highlight(q.text,coverage,'transcriptEvidence')+'</div></div><div><h4>Your summary</h4><div class="response">'+highlight(response,coverage,'evidence')+'</div></div></div>'
      + (coverage.length ? '<ul class="sst-coverage-list">'+coverage.map(c => '<li><span class="sst-status sst-evidence-'+c.status+'">'+esc(c.status)+'</span><strong>'+esc(c.point)+'</strong><p>'+esc(c.feedback)+'</p></li>').join('')+'</ul>' : '')+'</section>';
  }
  const tokens = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
  const maximumFor = q => q.type === 'wfd' ? tokens(q.text).length : ({ swt: 9, sst: 12, essay: 26 })[q.type];
  function score90(total, maximum) {
    if (!Number.isFinite(total) || !Number.isFinite(maximum) || maximum <= 0 || total < 0 || total > maximum) return null;
    return Math.round(10 + 80 * total / maximum);
  }
  function minutesFor(questions) {
    return questions.reduce((sum, q, i) => sum + (i && q.timeGroup && q.timeGroup === questions[i - 1].timeGroup ? 0 : q.minutes), 0);
  }
  function summarize(questions, results = []) {
    const groups = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i], r = results[i], maximum = maximumFor(q);
      const group = groups[q.type] ||= { type: q.type, label: labels[q.type], count: 0, marked: 0, total: 0, maximum: 0, provisional: false };
      group.count++; group.maximum += maximum;
      if (r && r.maximum === maximum && score90(r.total, maximum) !== null) { group.marked++; group.total += r.total; }
      if (provisional(r)) group.provisional = true;
    }
    const byType = Object.values(groups).map(g => ({ ...g, score90: g.marked === g.count ? score90(g.total, g.maximum) : null }));
    const total = byType.reduce((sum, g) => sum + g.total, 0), maximum = byType.reduce((sum, g) => sum + g.maximum, 0);
    const complete = questions.length > 0 && byType.every(g => g.marked === g.count);
    return { complete, total, maximum, score90: complete ? score90(total, maximum) : null, byType, provisional:byType.some(g => g.provisional) };
  }
  return { labels, tokens, maximumFor, score90, minutesFor, summarize, provisional, sstCoverage, sstReview };
});
