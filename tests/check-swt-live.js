'use strict';
// Opt-in paid model checks against the configured app, without a userId or
// progress writes. Not part of npm test; never confuse mocked policy tests
// with semantic calibration. --mode=proxy tests a local rubric before deploy.
const assert = require('node:assert/strict');
const { studentPassage } = require('../swt-reference');
const { POLICY_VERSION, buildJudgingPrompt, applyScoringPolicy } = require('../swt-scoring-policy');
const { createJudgmentService } = require('../swt-judgment-service');
const seeds = require('../passages.json');
const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
if (!args.url || !['proxy', 'grade'].includes(args.mode)) {
  console.error('Usage: node tests/check-swt-live.js --url=https://your-app --mode=proxy|grade');
  process.exit(1);
}
const origin = new URL(args.url).origin;
async function request(path, body) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(70000) });
  const data = await response.json();
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + path);
  return data;
}
const judge = createJudgmentService({ policyVersion: POLICY_VERSION, buildPrompt: buildJudgingPrompt,
  isComplete: (j, text) => !applyScoringPolicy(j, text).needs_semantic_review,
  call: async prompt => {
    const result = await request('/api/claude', { model: args.model || 'claude-haiku-4-5-20251001',
      max_tokens: 2800, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    const text = result.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || 'null');
  }
});
async function main() {
  const [passage8, passage9, passage6, passage7] = await Promise.all([8, 9, 6, 7].map(id => request('/api/passages/' + id)));
  const cases = [
    { name: 'Tourism screenshot', p: passage8, text: seeds.find(p => p.id === 8).sampleResponse, full: true },
    { name: 'Web screenshot', p: passage9, text: seeds.find(p => p.id === 9).sampleResponse, full: true },
    { name: 'Tourism revised reference', p: passage8, text: studentPassage(passage8).sampleResponse, full: true },
    { name: 'Web revised reference', p: passage9, text: studentPassage(passage9).sampleResponse, full: true },
    { name: 'London compressed cause', p: passage6, full: true, text: 'Although London faced historical setbacks and continues to struggle with high living costs and overloaded infrastructure, deregulation and regulatory advantages have allowed its financial center to surpass global rivals in fund management, foreign exchange trading, and secondary bonds.' },
    { name: 'Nobel opening only', p: passage7, full: false, max: 1, text: "This year's Nobel peace prize justly rewards the thousands of scientists of the United Nations climate change panel (the IPCC)." },
    { name: 'Tourism explicit false cause', p: passage8, full: false, text: 'Travel and tourism contributes to global GDP and employment, and its conservation work directly causes its start-up and running costs to fall, giving it an advantage over other industries.' },
    { name: 'Web reversed cause', p: passage9, full: false, text: 'Sir Tim Berners-Lee invented the World Wide Web because its global transformation of shopping and communication had already given everyone equal access to information, causing his frustration with scattered information.' }
  ];
  let failed = 0;
  for (const c of cases.filter(c => !args.cases || args.cases.split(',').some(name => c.name.includes(name)))) {
    let assessment;
    try {
      let result;
      if (args.mode === 'grade') {
        const data = await request('/api/grade', { type: 'swt', passageId: c.p.id, text: c.text,
          prompt: c.p.text, keyPoints: c.p.keyElements });
        assert.equal(data.score_provisional, false, 'Model assessment must be complete');
        result = { content: data.trait_scores.content, grammar: data.trait_scores.grammar,
          vocabulary: data.trait_scores.vocabulary, estimate: data.overall_score,
          note: data.content_details?.notes, version: data.scoring_version };
      } else {
        const hints = Object.entries(c.p.keyElements || {}).map(([key, value]) => '- ' + key + ': ' + value).join('\n');
        const j = applyScoringPolicy(await judge.judge(c.text, c.p.text, hints), c.text);
        assessment = j.summary_assessment;
        assert.equal(j.needs_semantic_review, false, 'Model assessment must be complete');
        result = { content: j.content_score, grammar: j.grammar_score, vocabulary: j.vocabulary_score,
          note: j.content_reason, reviewed: !!j.consistency_reviewed };
      }
      console.log(JSON.stringify({ case: c.name, ...result }));
      if (c.full) {
        assert.equal(result.content, 4); assert.equal(result.grammar, 2); assert.equal(result.vocabulary, 2);
      } else assert(result.content <= (c.max ?? 3), 'Incomplete or false meaning must not earn full content');
    } catch (error) {
      failed++;
      console.error(c.name + ': ' + error.message);
      if (assessment) console.error(JSON.stringify({ case: c.name, assessment }));
    }
  }
  if (args.mode === 'grade') {
    for (const p of [passage8, passage9]) {
      const checked = await request('/api/swt/sample/' + p.id, {});
      try { assert.equal(checked.status, 'verified'); }
      catch (error) { failed++; }
      console.log(JSON.stringify({ case: 'Reference check ' + p.id, status: checked.status, note: checked.note }));
    }
  }
  console.log('Live calibration: ' + (failed ? failed + ' failed' : 'all passed'));
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
