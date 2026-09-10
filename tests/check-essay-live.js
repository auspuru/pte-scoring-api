'use strict';
// Explicit opt-in paid model checks. These requests never save user progress.
const assert = require('node:assert/strict');
const { createEssayGrader } = require('../essay-grading');
const policy = require('../public/essay-scoring');
const fixture = require('./essay-fixtures');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
if (!args.url || !['proxy','grade'].includes(args.mode)) throw new Error('Provide --url and --mode=proxy|grade');
const base = new URL(args.url).origin;
async function post(path, data) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(85000) });
  const result = await r.json();
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (result.error || path));
  return result;
}
const grader = createEssayGrader(async prompt => {
  const response = await post('/api/claude', { model: 'claude-haiku-4-5-20251001', temperature: 0, max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }] });
  if (response.stop_reason === 'max_tokens') throw new Error('Truncated assessment');
  const raw = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || 'null');
});
(async () => {
  const cases = [
    { name: 'Balanced media essay without an unrequested opinion', ...fixture, minContent: 4, spelling: 2 },
    { name: 'Real misspelling', question: fixture.question, essay: fixture.essay.replace('information', 'infromation'), minContent: 4, spelling: 1 },
    { name: 'Unrelated response', question: 'Should governments invest more in railway construction than in roads? Give your opinion and reasons.', essay: fixture.essay, maxContent: 1, spelling: 2 }
  ];
  let failed = 0;
  for (const c of cases) {
    try {
      const result = args.mode === 'proxy' ? await grader.grade(c.question, c.essay)
        : await post('/api/essay/grade', { question: c.question, essay: c.essay });
      policy.normalizeResult(result, c.essay);
      console.log(JSON.stringify({ case: c.name, words: result.wordCount, scores: result.scores, improvements: result.improvements, optional: result.optionalRefinements.length, version: result.scoring_version }));
      assert.equal(result.scores.form, 2);
      assert.equal(result.scores.spelling, c.spelling);
      if (c.minContent) assert(result.scores.content >= c.minContent);
      if (c.maxContent !== undefined) assert(result.scores.content <= c.maxContent);
      if (result.scores.total < 26) assert(result.improvements.length > 0);
      if (c.minContent) assert(!/add (?:your|a personal) opinion|state your (?:own )?opinion/i.test(JSON.stringify(result.feedback)));
    } catch (error) { failed++; console.error(c.name + ': ' + error.message); }
  }
  console.log('Live essay checks: ' + (failed ? failed + ' failed' : 'all passed'));
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
