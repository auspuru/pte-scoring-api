(function (root, factory) {
  const report = factory();
  if (typeof module === 'object' && module.exports) module.exports = report;
  else root.WritingLabReport = report;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const labels = { swt: 'Summarise Written Text', essay: 'Write Essay', sst: 'Summarise Spoken Text', wfd: 'Write from Dictation' };
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
      const group = groups[q.type] ||= { type: q.type, label: labels[q.type], count: 0, marked: 0, total: 0, maximum: 0 };
      group.count++; group.maximum += maximum;
      if (r && r.maximum === maximum && score90(r.total, maximum) !== null) { group.marked++; group.total += r.total; }
    }
    const byType = Object.values(groups).map(g => ({ ...g, score90: g.marked === g.count ? score90(g.total, g.maximum) : null }));
    const total = byType.reduce((sum, g) => sum + g.total, 0), maximum = byType.reduce((sum, g) => sum + g.maximum, 0);
    const complete = questions.length > 0 && byType.every(g => g.marked === g.count);
    return { complete, total, maximum, score90: complete ? score90(total, maximum) : null, byType };
  }
  return { labels, tokens, maximumFor, score90, minutesFor, summarize };
});
