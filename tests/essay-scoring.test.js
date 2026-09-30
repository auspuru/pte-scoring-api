'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../public/essay-scoring');
const sync = require('../essay-attempt-sync');
const { createEssayGrader, essayResultForClient } = require('../essay-grading');
const { question, essay } = require('./essay-fixtures');
const uiSource = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function good() {
  return { scores: { ...policy.MAXIMA },
    feedback: Object.fromEntries(Object.keys(policy.MAXIMA).map(key => [key, 'Your ideas are clear and relevant.'])),
    errors: [], optionalRefinements: [],
    promptCoverage: [{ requirement: 'Positive and negative effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }],
    scoringEvidence: {
      linguisticExamples: ['mass media supports learning', 'Schools can respond by teaching students'],
      developmentEvidence: ['News reports help students understand events', 'Advertisements often connect expensive products'],
      vocabularyExamples: ['critical reading', 'unrealistic expectations']
    },
    templateDetector: 'good', templateNote: 'The structure is filled with relevant ideas.',
    strengths: ['Clear relevant examples.'], improvements: [],
    sampleStatus: 'ready', sampleResponse: essay,
    sampleSourceIdeas: ['mass media supports learning', 'unrealistic expectations'], sampleNote: '' };
}

function goodReview(overrides = {}) {
  return {
    scores: { content: 6, linguistic: 6, coherence: 6, ...(overrides.scores || {}) },
    promptCoverage: overrides.promptCoverage || [
      { requirement: 'Positive and negative effects', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' }
    ],
    scoringEvidence: overrides.scoringEvidence || {
      linguisticExamples: ['mass media supports learning', 'Schools can respond by teaching students'],
      developmentEvidence: ['News reports help students understand events', 'Advertisements often connect expensive products']
    },
    rationale: { content: 'Complete and relevant.', linguistic: 'Varied controlled expression.', coherence: 'Ideas are developed and connected.' }
  };
}

function sampleOnly() {
  return {
    sampleStatus: 'ready',
    sampleResponse: essay,
    sampleSourceIdeas: ['mass media supports learning', 'unrealistic expectations'],
    sampleNote: ''
  };
}

function standardModelResponse(prompt, primary = good()) {
  if (/Independently review ONLY/.test(prompt) || /Resolve a disagreement/.test(prompt)) return goodReview();
  if (/do not rescore or change the assessment/.test(prompt)) return sampleOnly();
  return primary;
}

test('Essay word-count boundaries are deterministic and independent of model counting', () => {
  for (const [count, expected] of [[119,0],[120,1],[199,1],[200,2],[280,2],[300,2],[301,1],[380,1],[381,0]]) {
    const result = policy.formFor(Array(count).fill('word').join(' ') + '.');
    assert.equal(result.count, count); assert.equal(result.score, expected);
    if (expected === 1) assert.match(result.feedback, /within the 120–380 allowed range/);
  }
  const raw = good(); raw.scores.form = 0; raw.feedback.form = 'Only 90 words, too short.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scores.form, 2);
  assert.equal(result.wordCount, policy.words(essay));
  assert(!result.feedback.form.includes('90 words'));

  const allCaps = policy.formFor((Array(220).fill('WORD').join(' ') + '.'));
  assert.equal(allCaps.score, 0);
  assert.match(allCaps.feedback, /capital letters/i);

  const noPunctuation = policy.formFor(Array(220).fill('word').join(' '));
  assert.equal(noPunctuation.score, 0);
  assert.match(noPunctuation.feedback, /no punctuation/i);

  const bullets = policy.formFor(Array.from({ length: 40 }, (_, i) => '- point ' + i + ' explains the issue clearly').join('\n'));
  assert.equal(bullets.score, 0);
  assert.match(bullets.feedback, /bullet points|list/i);
});

test('Content zero hard-stops every trait and structural Form failures score zero', () => {
  const raw = good();
  raw.scores.content = 0;
  raw.promptCoverage = [{ requirement: 'Positive and negative effects', status: 'missing', evidence: '', nextStep: 'Answer the media question directly.' }];
  raw.sampleStatus = 'needs-ideas'; raw.sampleResponse = ''; raw.sampleSourceIdeas = []; raw.sampleNote = 'Add relevant ideas.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scoreGate.status, 'zero_content');
  assert.equal(result.scores.total, 0);
  for (const key of Object.keys(policy.MAXIMA)) assert.equal(result.scores[key], 0);
  assert.equal(result.diagnosticScores.form, 2);

  const allCaps = Array(220).fill('WORD').join(' ') + '.';
  assert.equal(policy.formFor(allCaps).score, 0);
  assert.match(policy.formFor(allCaps).feedback, /capital/i);

  const noPunctuation = Array(220).fill('word').join(' ');
  assert.equal(policy.formFor(noPunctuation).score, 0);
  assert.match(policy.formFor(noPunctuation).feedback, /punctuation/i);
});

test('Top Coherence and Linguistic marks require exact supporting evidence', () => {
  const linguistic = good();
  linguistic.scoringEvidence.linguisticExamples = [];
  assert.throws(() => policy.normalizeResult(linguistic, essay), { code: 'linguistic_evidence' });

  const coherence = good();
  coherence.scoringEvidence.developmentEvidence = [];
  assert.throws(() => policy.normalizeResult(coherence, essay), { code: 'development_evidence' });
});

test('Zero-Content API adapts safely for stale and current clients', () => {
  const raw = good();
  raw.scores.content = 0;
  raw.promptCoverage = [{ requirement: 'Positive and negative effects', status: 'missing', evidence: '', nextStep: 'Answer the media question directly.' }];
  raw.sampleStatus = 'needs-ideas'; raw.sampleResponse = ''; raw.sampleSourceIdeas = []; raw.sampleNote = 'Add relevant ideas.';
  const canonical = policy.normalizeResult(raw, essay);

  const current = essayResultForClient(canonical, policy.VERSION);
  assert.deepEqual(current, canonical);
  for (const key of Object.keys(policy.MAXIMA)) assert.equal(current.scores[key], 0);

  const legacy = essayResultForClient(canonical, '');
  assert.equal(legacy.compatibility, 'legacy-zero-content-input');
  assert.equal(legacy.scores.content, 0);
  assert.equal(legacy.scores.spelling, canonical.diagnosticScores.spelling);
  assert.equal(legacy.scores.grammar, canonical.diagnosticScores.grammar);
  assert.equal(legacy.scores.total, 0);
  assert.equal(policy.normalizeResult(legacy, essay).scores.total, 0);
});

test('Zero-Content server results remain valid in the browser after the hard gate zeros language traits', () => {
  const raw = good();
  raw.scores.content = 0;
  raw.promptCoverage = [{ requirement: 'Positive and negative effects', status: 'missing', evidence: '', nextStep: 'Answer the media question directly.' }];
  raw.sampleStatus = 'needs-ideas'; raw.sampleResponse = ''; raw.sampleSourceIdeas = []; raw.sampleNote = 'Add relevant ideas.';
  const server = policy.normalizeResult(raw, essay);
  assert.equal(server.scoreGate.status, 'zero_content');
  assert.equal(server.diagnosticScores.content, 0);
  assert.equal(server.diagnosticScores.spelling, 2);
  assert.equal(server.diagnosticScores.grammar, 2);
  for (const key of Object.keys(policy.MAXIMA)) assert.equal(server.scores[key], 0);
  assert.deepEqual(policy.normalizeResult(server, essay), server);
});

test('Zero-Form server results remain valid in the browser and do not call the model', async () => {
  const short = Array(100).fill('word').join(' ') + '.';
  let calls = 0;
  const grader = createEssayGrader(async () => { calls++; throw new Error('Model must not be called for Form 0'); });
  const result = await grader.grade(question, short);
  assert.equal(calls, 0);
  assert.equal(result.scoreGate.status, 'zero_form');
  assert.equal(result.scores.total, 0);
  assert.deepEqual(policy.normalizeResult(result, short), result);
});

test('Style refinements are separate from actual grammar and never disguised as errors', () => {
  const raw = good();
  raw.errors = [{ type: 'style', phrase: 'has become increasingly important', correction: 'has gained importance', explanation: 'A shorter option.' }];
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.errors.length, 0);
  assert.equal(result.optionalRefinements.length, 1);
  assert.equal(result.optionalRefinements[0].affects_score, false);
  assert.equal(result.scores.grammar, 2);
});

test('Missing traits, unexplained language deductions and fabricated quotations cannot become saved zeros', () => {
  const variants = [raw => delete raw.scores.content,
    raw => { raw.scores.grammar = 1; },
    raw => { raw.scores.spelling = 0; },
    raw => { raw.promptCoverage[0].evidence = 'The essay never says this'; },
    raw => { raw.scores.linguistic = 4.8; },
    raw => { raw.feedback.content = ''; }];
  for (const change of variants) {
    const raw = good(); change(raw);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
});

test('A content deduction always has a next step, even if the model omitted improvements', () => {
  const raw = good(); raw.scores.content = 4;
  raw.promptCoverage[0] = { requirement: 'Positive and negative effects', status: 'partial',
    evidence: 'mass media supports learning', nextStep: 'Explain one negative effect on young people with an example.' };
  delete raw.improvements;
  const result = policy.normalizeResult(raw, essay);
  assert.match(result.improvements[0], /negative effect/);
  raw.scores.content = 6;
  assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
});

test('Content zero hard-gates the complete essay to zero', () => {
  const raw = good();
  raw.scores.content = 0;
  raw.promptCoverage = [{
    requirement: 'Positive and negative effects',
    status: 'missing',
    evidence: '',
    nextStep: 'Answer the actual essay question.'
  }];
  raw.sampleStatus = 'needs-ideas';
  raw.sampleResponse = '';
  raw.sampleSourceIdeas = [];
  raw.sampleNote = 'Add relevant ideas that answer the question.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scoreGate.status, 'zero_content');
  assert.equal(result.scores.total, 0);
  for (const key of Object.keys(policy.MAXIMA)) assert.equal(result.scores[key], 0);
  assert.equal(result.diagnosticScores.form, 2);
});

test('Incomplete relevant coverage reduces Content without an invented total-score cap', () => {
  const raw = good();
  raw.scores.content = 4;
  raw.promptCoverage = [
    { requirement: 'Positive effect', status: 'addressed', evidence: 'mass media supports learning', nextStep: '' },
    { requirement: 'Negative effect', status: 'partial', evidence: 'unrealistic expectations', nextStep: 'Develop the negative effect further.' }
  ];
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scoreGate.status, 'valid');
  assert.equal(result.scores.content, 4);
  assert.equal(result.scores.total, 24);
});

test('Stitched coverage evidence is repaired to a real excerpt without admitting fabricated evidence', () => {
  const raw = good();
  raw.promptCoverage[0].evidence = 'Advertisements often connect expensive products with happiness or popularity, which may lead teenagers to compare themselves with carefully selected images. Schools can respond by teaching students to distinguish evidence from opinion and recognise commercial messages.';
  const result = policy.normalizeResult(raw, essay);
  assert(essay.includes(result.promptCoverage[0].evidence));
  assert(!result.promptCoverage[0].evidence.includes('Schools can respond'));
  assert.equal(result.scores.total, 26);
  raw.promptCoverage[0].evidence = 'Completely invented claims about rockets and submarines';
  assert.throws(() => policy.normalizeResult(raw, essay), { code: 'coverage_quote' });
  const spaced = essay.replace('mass media supports learning', 'mass media  supports\nlearning');
  assert.doesNotThrow(() => policy.normalizeResult(good(), spaced));
});

test('Quoted real misspellings support deductions without counting stylistic advice', () => {
  const text = essay.replace('information', 'infromation');
  const raw = good(); raw.scores.spelling = 1;
  raw.errors = [{ type: 'spelling', phrase: 'infromation', correction: 'information', impact: 'minor', explanation: 'Correct the letter order.' }];
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.spelling, 1);
  assert.equal(result.scores.grammar, 2);
  assert.deepEqual(result.spellingErrors, ['infromation']);
});

test('Meaning-changing language errors are the only grammar deductions', () => {
  const text = essay.replace('can educate', 'cannot educate');
  const raw = good(); raw.scores.grammar = 1;
  raw.errors = [{ type: 'grammar', phrase: 'cannot educate', correction: 'can educate', impact: 'meaning',
    explanation: 'The added negation reverses the claim about what media can do.' }];
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.grammar, 1);
  assert.deepEqual(result.grammarIssues, ['cannot educate']);
});

test('Minor learner grammar gets coherent feedback and survives server and browser validation', () => {
  const text = essay.replace('mass media supports learning', 'mass media support learning');
  const raw = good(); raw.scores.grammar = 1;
  raw.promptCoverage[0].evidence = 'mass media support learning';
  raw.scoringEvidence.linguisticExamples[0] = 'mass media support learning';
  raw.sampleSourceIdeas[0] = 'mass media support learning';
  raw.errors = [{ type: 'grammar', phrase: 'mass media support learning', correction: 'mass media supports learning',
    impact: 'meaning', explanation: 'The singular subject requires the verb supports.' }];
  raw.feedback.grammar = 'One grammar error costs a mark.';
  const result = policy.normalizeResult(raw, text);
  assert.equal(result.scores.grammar, 2);
  assert.match(result.feedback.grammar, /Full Grammar marks/);
  assert.equal(result.optionalRefinements.length, 1);
  assert.deepEqual(policy.normalizeResult(result, text), result);
});

test('Shared assessment prompt does not generate the learning sample', () => {
  const prompt = policy.buildAssessmentPrompt(question, essay);
  assert.match(prompt, /Do not generate or rewrite a sample essay/);
  assert.doesNotMatch(prompt, /"sampleStatus"/);
  assert.doesNotMatch(prompt, /complete 200–300-word essay in four paragraphs/);
});

test('Prompt requires an opinion only when the question asks and avoids template-count rules', () => {
  const prompt = policy.buildPrompt(question, essay);
  assert.match(prompt, /personal opinion only if the question requests one/);
  assert.match(prompt, /not a one-sentence SWT summary/);
  assert.match(prompt, /Do not claim database matching/);
  assert.match(prompt, /optionalRefinements/);
});

test('Age-restriction prompt explains that one example is sufficient', () => {
  const ageQuestion = 'Age restrictions are placed on many activities. It is believed that people should not do things until they reach the right ages, such as getting married, driving, voting, buying certain products, and doing particular things. Give an example, state which minimum age you think it should be and share your own experience.';
  const note = policy.taskFocusNote(ageQuestion);
  assert.match(note, /one example/i);
  assert.match(note, /other activities listed are optional/i);
  assert.equal(policy.taskFocusNote('Give an example and explain your opinion about education.'), '');
  const prompt = policy.buildPrompt(ageQuestion, essay);
  assert.match(prompt, /Treat one developed example as sufficient coverage/);
  assert.match(prompt, /Do not require the student to discuss every activity listed/);
});

test('The renderer allows change markers but escapes model-supplied HTML and scripts', () => {
  const result = policy.renderExcerpt('A <span class="diff-ins">clearer</span> idea <img src=x onerror="bad()"><script>bad()</script>');
  assert(result.includes('<span class="diff-ins">clearer</span>'));
  assert(!result.includes('<img')); assert(!result.includes('<script>'));
  assert(result.includes('&lt;img'));
});

test('Essay Practice requires 120 words before requesting a score', () => {
  assert.match(uiSource, /countWords\(essay\) < 120/);
  assert.match(uiSource, /at least 120 words before scoring/);
});

test('Essay UI enables scoring only from 120 words and sends the scorer version', () => {
  assert.match(uiSource, /countWords\(practiceState\.essayText\) >= 120/);
  assert.match(uiSource, /Write at least 120 words to score/);
  assert.match(uiSource, /X-Essay-Scoring-Version/);
  assert.match(uiSource, /EssayScoring\.VERSION/);
});

test('Essay sample targeting supports Bands 6–9 without changing the scoring rubric', () => {
  const assessment = policy.normalizeAssessment(good(), essay);
  for (const band of ['6', '7', '8', '9']) {
    assert.equal(policy.normalizeSampleBand('Band ' + band), band);
    const prompt = policy.buildSamplePrompt(question, essay, assessment, band);
    assert.match(prompt, new RegExp('BAND ' + band + ' SAMPLE'));
    assert.match(prompt, new RegExp('selected Band ' + band + ' target'));
  }
  assert.match(uiSource, /Desired sample response band/);
  assert.match(uiSource, /JSON\.stringify\(\{ question, essay, sampleBand \}\)/);
  assert.match(uiSource, /sampleBand: '9'/);
});

test('Choosing a desired sample band stays in Essay Practice without starting account sync', () => {
  let stopped = false;
  const saves = [];
  const browser = {
    window: { EssayScoring: policy }, EssayScoring: policy,
    practiceState: { view: 'write', sampleBand: '9' },
    savePortalEssayDraft: options => saves.push(options)
  };
  vm.createContext(browser);
  vm.runInContext(browserFunction('practiceSampleBand') + '\n' + browserFunction('setPracticeSampleBand'), browser);
  browser.setPracticeSampleBand('7', { stopPropagation() { stopped = true; } });
  assert.equal(browser.practiceState.sampleBand, '7');
  assert.equal(stopped, true);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].skipSync, true);
  assert.doesNotMatch(browserFunction('setPracticeSampleBand'), /queuePortalEssayDraft/);
  assert.match(uiSource, /activeElement\?\.matches\?\.\('input,textarea,select,\[contenteditable="true"\]'\)/);
});

test('Essay sample cache is separated by requested band', async () => {
  const samplePrompts = [];
  const grader = createEssayGrader(async prompt => {
    if (/do not rescore or change the assessment/.test(prompt)) {
      samplePrompts.push(prompt);
      return sampleOnly();
    }
    return standardModelResponse(prompt);
  });
  const six = await grader.grade(question, essay, '6');
  const eight = await grader.grade(question, essay, '8');
  assert.equal(six.sampleBand, '6');
  assert.equal(eight.sampleBand, '8');
  assert.equal(samplePrompts.length, 2);
  assert.match(samplePrompts[0], /BAND 6 SAMPLE/);
  assert.match(samplePrompts[1], /BAND 8 SAMPLE/);
});

test('Essay notifications are concise and always self-dismiss', () => {
  assert.match(uiSource, /t\.classList\.toggle\('long', text\.length > 180\)/);
  assert.match(uiSource, /toastTimer = setTimeout\(dismiss, 4200\)/);
  assert.match(uiSource, /if \(!t\.classList\.contains\('show'\)\) t\.textContent = ''/);
  assert.doesNotMatch(uiSource, /Your Band 9 sample is ready\./);
  assert.match(uiSource, /practiceSampleBandLabel\(sample\.sampleBand\)/);
  assert.match(uiSource, /Add the missing personal\/task detail shown in your results/);
  assert.match(htmlSource, /index\.css\?v=20260928-toastfix/);
  assert.match(htmlSource, /index\.min\.js\?v=20260930-essay-next-steps/);
});

test('Essay UI uses the validated grader and keeps the detailed rubric secondary', () => {
  assert.match(uiSource, /\/api\/essay\/grade/);
  assert.match(uiSource, /EssayScoring\.normalizeResult\(data, essay\)/);
  assert.match(uiSource, /EssayScoring\.taskFocusNote/);
  assert.match(uiSource, /<span class="pte-metric-label">Practice score<\/span>/);
  assert.match(uiSource, /<details class="essay-feedback-details"><summary>Score breakdown and feedback<\/summary>/);
  assert.match(htmlSource, /essay-scoring\.js\?v=20260928-band-samples/);
});

test('Incomplete model output gets one retry; only validated assessments are cached', async () => {
  let calls = 0;
  const grader = createEssayGrader(async prompt => {
    calls++;
    if (calls === 1) return {};
    return standardModelResponse(prompt);
  });
  const [a, b] = await Promise.all([grader.grade(question, essay), grader.grade(question, essay)]);
  assert.equal(calls, 4); // failed primary + valid primary + independent review + separate learning sample
  assert.equal(a.scores.total, 26);
  assert.deepEqual(a, b);
  a.scores.content = 0;
  assert.equal((await grader.grade(question, essay)).scores.content, 6);
  assert.equal(calls, 4);

  let failures = 0;
  const broken = createEssayGrader(async () => { failures++; throw new Error('provider failed'); });
  await assert.rejects(() => broken.grade(question, essay));
  assert.equal(failures, 2, 'A failed assessment is retried, not converted into a fabricated local score.');
});

test('A malformed independent review cannot erase a validated primary essay score', async () => {
  let reviewCalls = 0;
  const failures = [];
  const grader = createEssayGrader(async prompt => {
    if (/Independently review ONLY/.test(prompt)) {
      reviewCalls++;
      return {
        scores: { content: 6, linguistic: 6, coherence: 6 },
        promptCoverage: [{ requirement: 'Positive and negative effects', status: 'mostly addressed', evidence: 'mass media supports learning', nextStep: '' }],
        scoringEvidence: {
          linguisticExamples: ['mass media supports learning', 'Schools can respond by teaching students'],
          developmentEvidence: ['News reports help students understand events', 'Advertisements often connect expensive products']
        },
        rationale: {}
      };
    }
    return good();
  }, { onAttemptError: detail => failures.push(detail) });

  const result = await grader.grade(question, essay);
  assert.equal(reviewCalls, 2);
  assert.equal(result.scores.total, 26);
  assert.equal(result.subjectiveReview.source, 'primary-only');
  assert.equal(result.subjectiveReview.status, 'independent-review-unavailable');
  assert.equal(result.sampleKind, 'full-essay');
  assert.equal(failures.filter(item => item.stage === 'subjective-review').length, 2);
});

test('Material disagreement in subjective traits is resolved before the final score is returned', async () => {
  let resolverSeen = false;
  const grader = createEssayGrader(async prompt => {
    if (/Resolve a disagreement/.test(prompt)) {
      resolverSeen = true;
      return goodReview({
        scores: { content: 4, linguistic: 5, coherence: 5 },
        promptCoverage: [{ requirement: 'Positive and negative effects', status: 'partial', evidence: 'mass media supports learning', nextStep: 'Develop the negative effects more fully.' }],
        scoringEvidence: {
          linguisticExamples: ['mass media supports learning'],
          developmentEvidence: ['News reports help students understand events']
        }
      });
    }
    if (/Independently review ONLY/.test(prompt)) {
      return goodReview({
        scores: { content: 3, linguistic: 4, coherence: 4 },
        promptCoverage: [{ requirement: 'Positive and negative effects', status: 'partial', evidence: 'mass media supports learning', nextStep: 'Develop the negative effects more fully.' }],
        scoringEvidence: {
          linguisticExamples: ['mass media supports learning'],
          developmentEvidence: ['News reports help students understand events']
        }
      });
    }
    if (/do not rescore or change the assessment/.test(prompt)) return sampleOnly();
    return good();
  });
  const result = await grader.grade(question, essay);
  assert.equal(resolverSeen, true);
  assert.equal(result.subjectiveReview.source, 'resolver');
  assert.equal(result.diagnosticScores.content, 4);
  assert.equal(result.diagnosticScores.linguistic, 5);
  assert.equal(result.diagnosticScores.coherence, 5);
  assert.equal(result.scores.total, 22);
});

test('Full-score essays retain a complete sample and sample changes never alter original scores', () => {
  const raw = good();
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.scores.total, 26);
  assert.equal(result.sampleResponse, essay);
  assert.equal(result.sampleKind, 'full-essay');
  assert.equal(result.sampleWordCount, policy.words(essay));
  assert.deepEqual(policy.normalizeResult(result, essay), result, 'Server results remain valid in the browser');
  const lower = good(); lower.scores.vocabulary = 1;
  const a = policy.normalizeResult(lower, essay);
  lower.sampleResponse = essay.replace('in recent years', 'in modern society');
  const b = policy.normalizeResult(lower, essay);
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.feedback, b.feedback);
  assert.equal(b.scores.total, 25);
});

test('Incomplete, excerpt-only, ungrounded or marked-up samples are retried instead of shown', async () => {
  for (const change of [
    raw => { raw.sampleResponse = ''; },
    raw => { raw.sampleResponse = 'Only a short excerpt.'; },
    raw => { raw.sampleResponse = essay.replace(/\n\n/g, ' '); },
    raw => { raw.sampleResponse = essay + ' additional'.repeat(301); },
    raw => { raw.sampleResponse = essay.replace('mass media', '<b>mass media</b>'); },
    raw => { raw.sampleSourceIdeas = ['A fabricated idea absent from the original']; },
    raw => { raw.sampleSourceIdeas = []; },
    raw => { delete raw.sampleStatus; }
  ]) {
    const raw = good(); change(raw);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
  let primaryCalls = 0;
  let sampleCalls = 0;
  const grader = createEssayGrader(async prompt => {
    if (/Independently review ONLY/.test(prompt)) return goodReview();
    if (/do not rescore or change the assessment/.test(prompt)) {
      sampleCalls++;
      return sampleOnly();
    }
    primaryCalls++;
    const raw = good();
    raw.sampleResponse = 'Too short.';
    return raw;
  });
  const result = await grader.grade(question, essay);
  assert.equal(primaryCalls, 1);
  assert.equal(sampleCalls, 1);
  assert.equal(result.sampleResponse, essay);
});

test('A failed sample preserves the grade and a later retry does not rescore it', async () => {
  let assessmentCalls = 0;
  let reviewCalls = 0;
  let sampleCalls = 0;
  const grader = createEssayGrader(async prompt => {
    if (/Independently review ONLY/.test(prompt)) {
      reviewCalls++;
      return goodReview();
    }
    if (/do not rescore or change the assessment/.test(prompt)) {
      sampleCalls++;
      if (sampleCalls <= 2) throw new Error('Temporary sample provider failure');
      return sampleOnly();
    }
    assessmentCalls++;
    return { ...good(), sampleResponse: 'Too short.' };
  });

  const partial = await grader.grade(question, essay);
  assert.equal(partial.scores.total, 26);
  assert.equal(partial.sampleKind, 'unavailable');
  assert.equal(assessmentCalls, 1);
  assert.equal(reviewCalls, 1);

  const ready = await grader.grade(question, essay);
  assert.equal(ready.sampleKind, 'full-essay');
  assert.equal(ready.sampleResponse, essay);
  assert.deepEqual(ready.scores, partial.scores);
  assert.equal(assessmentCalls, 1, 'A sample retry must not rescore the essay.');
  assert.equal(reviewCalls, 1, 'A sample retry must not rerun the subjective review.');
});

test('Assessment validation failures return a retryable failure instead of a fabricated local score', async () => {
  let calls = 0;
  const grader = createEssayGrader(async prompt => {
    calls++;
    if (calls > 1) assert.match(prompt, /VALIDATION RETRY:/);
    const raw = good();
    delete raw.scores.content;
    return raw;
  });
  await assert.rejects(() => grader.grade(question, essay));
  assert.equal(calls, 2);
});

test('Missing ideas produce an honest next step and cannot suppress a full-score sample', () => {
  const raw = good(); raw.scores.content = 1;
  raw.promptCoverage = [{ requirement: 'A position about railways versus roads', status: 'missing', evidence: '',
    nextStep: 'State which transport investment you support and give a reason.' }];
  raw.sampleStatus = 'needs-ideas'; raw.sampleResponse = ''; raw.sampleSourceIdeas = [];
  raw.sampleNote = 'Your essay discusses media. Add your position about railways versus roads and a supporting reason.';
  const result = policy.normalizeResult(raw, essay);
  assert.equal(result.sampleKind, 'needs-ideas');
  assert.equal(result.sampleResponse, '');
  assert.match(result.sampleNote, /railways versus roads/);
  assert.deepEqual(policy.normalizeResult(result, essay), result);
  delete raw.sampleNote;
  assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  const perfect = good(); perfect.sampleStatus = 'needs-ideas'; perfect.sampleResponse = ''; perfect.sampleNote = 'Already perfect.';
  assert.throws(() => policy.normalizeResult(perfect, essay), /incomplete/);
});

test('Sample instructions preserve student ideas and position independently of assessment', () => {
  const prompt = policy.buildPrompt(question, essay);
  for (const instruction of [/200–300 words in exactly four paragraphs/, /even when the original earns 26\/26/,
    /Do not replace their arguments/, /invent statistics/, /must never influence the original essay/,
    /Do not invent that position/, /sampleSourceIdeas/]) assert.match(prompt, instruction);
});

test('Samples reject introduced named examples and figures while retaining the student’s own evidence', () => {
  for (const phrase of ['News reports from Copenhagen', 'News reports from UNESCO', 'News reports about 85% of students']) {
    const raw = good(); raw.sampleResponse = essay.replace('News reports', phrase);
    assert.throws(() => policy.normalizeResult(raw, essay), /incomplete/);
  }
  const original = essay.replace('a local flood', 'a local flood in Sydney');
  const raw = good(); raw.sampleResponse = original;
  assert.equal(policy.normalizeResult(raw, original).sampleResponse, original);
});

function browserFunction(name) {
  const start = uiSource.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return uiSource.slice(start, uiSource.indexOf('\n}', start) + 2);
}

test('Saved samples keep their paragraphs and copy as plain text; legacy excerpts retain their label', () => {
  const result = policy.normalizeResult(good(), essay);
  const stored = JSON.parse(JSON.stringify({ ...result, id: 'sample-attempt', date: 1, essayText: essay }));
  const restored = sync.mergeHistory([], [stored], [])[0];
  const browser = { EssayScoring: policy, practiceSamplePendingId: null,
    practiceSampleBandLabel: value => 'Band ' + policy.normalizeSampleBand(value) };
  vm.createContext(browser);
  vm.runInContext(['escapeHtml', 'renderPracticeSample', 'getCleanSampleResponse'].map(browserFunction).join('\n'), browser);
  const html = browser.renderPracticeSample(restored);
  assert.match(html, /Band 9 sample · Your ideas/);
  assert.match(html, /Copy sample essay/);
  assert(!html.includes('Copy revised excerpt'));
  assert(html.includes(browser.escapeHtml(essay)));
  assert.equal(browser.getCleanSampleResponse(restored.sampleResponse, restored.sampleKind), essay);
  const legacy = browser.renderPracticeSample({ sampleResponse: 'A <span class="diff-ins">clearer</span> idea.' });
  assert.match(legacy, /Example revision/);
  assert.match(legacy, /Copy revised excerpt/);
  assert(!legacy.includes('Band 9 sample'));
  assert(legacy.includes('<span class="diff-ins">clearer</span>'));
  const hostile = browser.renderPracticeSample({ sampleKind: 'full-essay', sampleResponse: '<img src=x onerror="bad()">' });
  assert(!hostile.includes('<img'));
  const missing = browser.renderPracticeSample({ sampleKind: 'needs-ideas', sampleNote: '<script>bad()</script> Add a position.' });
  assert(!missing.includes('<script>'));
  assert.match(missing, /Add a position/);
  assert(!missing.includes('Copy sample essay'));
  const unavailable = browser.renderPracticeSample({ id: 'retry', sampleKind: 'unavailable', sampleNote: 'Your score is ready.' });
  assert.match(unavailable, /Retry sample/);
  assert(!unavailable.includes('Copy sample essay'));
});
