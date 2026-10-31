(function (root, factory) {
  const report = factory();
  if (typeof module === 'object' && module.exports) module.exports = report;
  else root.WritingLabReport = report;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const labels = { swt: 'Summarise Written Text', essay: 'Write Essay', sst: 'Summarise Spoken Text', wfd: 'Write from Dictation', lmcma:'Multiple Choice, Multiple Answers',lfi:'Fill in the Blanks (Type In)',hcs:'Highlight Correct Summary',lmcsa:'Multiple Choice, Single Answer',smw:'Select Missing Word',hiw:'Highlight Incorrect Words' };
  const WRITING_WEIGHTS = Object.freeze({ swt:28, essay:31, sst:18, wfd:23 });
  const WEIGHTING_VERSION = 'writing-task-weighted-2026-10-26.1';
  const isWritingMock = attempt => attempt?.kind === 'mock' && attempt.module !== 'listening';
  const needsReview = (result,question) => !!result && (result.score_provisional === true || result.needs_semantic_review === true
    || (question && (result.maximum !== maximumFor(question) || score90(result.total,maximumFor(question)) === null)));
  const tokens = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
  const maximumFor = q => ['lmcma','lfi','hcs','lmcsa','smw','hiw'].includes(q.type) ? (q.maximum || (['lmcma','lfi','hiw'].includes(q.type) ? q.answers.length : 1)) : q.type === 'wfd' ? tokens(q.text).length : ({ swt: 9, sst: 12, essay: 26 })[q.type];
  function score90(total, maximum) {
    if (!Number.isFinite(total) || !Number.isFinite(maximum) || maximum <= 0 || total < 0 || total > maximum) return null;
    return Math.round(10 + 80 * total / maximum);
  }
  function minutesFor(questions) {
    return questions.reduce((sum, q, i) => sum + (i && q.timeGroup && q.timeGroup === questions[i - 1].timeGroup ? 0 : q.minutes), 0);
  }
  function summarize(questions, results = [], attempt = {}) {
    const weighted = isWritingMock(attempt);
    const groups = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i], r = results[i], maximum = maximumFor(q);
      const group = groups[q.type] ||= { type: q.type, label: labels[q.type], count: 0, marked: 0, total: 0, maximum: 0 };
      group.count++; group.maximum += maximum;
      if (r && r.maximum === maximum && score90(r.total, maximum) !== null && (attempt.kind!=='mock' || !needsReview(r,q))) { group.marked++; group.total += r.total; }
    }
    const byType = Object.values(groups).map(g => ({ ...g, score90: g.marked === g.count ? score90(g.total, g.maximum) : null }));
    const total = byType.reduce((sum, g) => sum + g.total, 0), maximum = byType.reduce((sum, g) => sum + g.maximum, 0);
    let complete = questions.length > 0 && byType.every(g => g.marked === g.count);
    if (weighted) {
      const supported = byType.every(g => Object.hasOwn(WRITING_WEIGHTS,g.type));
      const weightTotal = byType.reduce((sum,g) => sum + (WRITING_WEIGHTS[g.type] || 0),0);
      complete = complete && supported && weightTotal > 0;
      for (const group of byType) {
        group.weight = WRITING_WEIGHTS[group.type] || 0;
        group.normalizedWeight = weightTotal ? 100 * group.weight / weightTotal : 0;
        group.performancePercent = group.marked === group.count ? 100 * group.total / group.maximum : null;
      }
      // Pool native points only WITHIN a task type. Question count and sentence
      // length must not multiply the task type's published weight a second time.
      // Keep the complete denominator, including zero-mark submitted answers.
      const ratio = complete ? byType.reduce((sum,g) => sum + g.weight * g.total / g.maximum,0) / weightTotal : null;
      const missingTypes = Object.keys(WRITING_WEIGHTS).filter(type => !groups[type]);
      return { complete, total, maximum, score90:complete ? score90(ratio,1) : null, byType,
        weighting:{ version:WEIGHTING_VERSION, profile:'writing', supported, weights:{...WRITING_WEIGHTS},
          weightTotal, fullProfile:supported && missingTypes.length === 0, missingTypes,
          performancePercent:complete ? ratio * 100 : null, calibration:'uncalibrated', conversion:'round(10 + 80 × weighted ratio)' } };
    }
    return { complete, total, maximum, score90: complete ? score90(total, maximum) : null, byType };
  }
  return { labels, tokens, maximumFor, score90, minutesFor, summarize, WRITING_WEIGHTS, WEIGHTING_VERSION, isWritingMock, needsReview };
});
