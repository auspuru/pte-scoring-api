'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEssayGrader } = require('../essay-grading');

const essay = [
  'Public transport helps cities move people efficiently while reducing the number of private cars on busy roads. Reliable services can make work, study and essential appointments easier to reach for people who do not drive. Frequent buses and trains can also reduce congestion when travellers have a practical alternative to using a car for every journey.',
  'Investment is most useful when services are frequent, safe and connected to the places people actually need to reach. A new route has limited value if it runs rarely or stops far from homes and workplaces. Clear timetables, accessible stations and simple transfers can make the network easier to use throughout the day.',
  'Roads still matter for freight, emergency services and areas where public transport cannot serve every trip. However, continually adding road capacity can encourage more driving and may use land that could support safer walking, cycling or transit. Governments should therefore compare each project with alternatives rather than assuming that one transport mode solves every problem.',
  'Overall, cities should give strong priority to dependable public transport while maintaining roads where they remain necessary. A balanced investment strategy can improve access, reduce congestion and give residents more realistic choices about how they travel.'
].join('\n\n');

const primary = {
  taskRelevance: { status: 'relevant', evidence: 'cities should give strong priority', reason: 'The essay compares transport investment priorities.' },
  scores: { content: 5, form: 2, spelling: 2, grammar: 2, vocabulary: 2, linguistic: 5, coherence: 5 },
  feedback: {
    content: 'Relevant and developed.',
    form: 'Valid length and prose form.',
    spelling: 'Accurate.',
    grammar: 'Accurate.',
    vocabulary: 'Appropriate.',
    linguistic: 'Good range.',
    coherence: 'Well organised.'
  },
  errors: [],
  optionalRefinements: [],
  promptCoverage: [{ requirement: 'address transport priorities', status: 'addressed', evidence: 'cities should give strong priority', nextStep: '' }],
  scoringEvidence: {
    linguisticExamples: ['Reliable services can make work'],
    developmentEvidence: ['Investment is most useful when services are frequent'],
    vocabularyExamples: ['balanced investment strategy']
  },
  strengths: [],
  improvements: ['Develop one point further.'],
  templateDetector: 'ok',
  templateEvidence: [],
  templateNote: '',
  overallVerdict: 'Good response.'
};

const review = {
  taskRelevance: { status: 'relevant', evidence: 'cities should give strong priority', reason: 'The essay compares transport investment priorities.' },
  scores: { content: 5, linguistic: 5, coherence: 5 },
  promptCoverage: [{ requirement: 'address transport priorities', status: 'addressed', evidence: 'cities should give strong priority', nextStep: '' }],
  scoringEvidence: {
    linguisticExamples: ['Reliable services can make work'],
    developmentEvidence: ['Investment is most useful when services are frequent']
  },
  rationale: {}
};

test('changing only sample band reuses the completed essay assessment', async () => {
  const calls = { primary: 0, review: 0, sample: 0 };
  const call = async prompt => {
    if (prompt.startsWith('Independently review ONLY')) {
      calls.review += 1;
      return review;
    }
    if (prompt.startsWith('The original essay has already been scored.')) {
      calls.sample += 1;
      return {
        sampleStatus: 'ready',
        sampleResponse: essay,
        sampleSourceIdeas: ['Public transport helps cities move people efficiently'],
        sampleNote: ''
      };
    }
    calls.primary += 1;
    return primary;
  };

  const grader = createEssayGrader(call);
  const question = 'Should cities prioritise public transport rather than building more roads?';
  const band6 = await grader.grade(question, essay, '6');
  const band9 = await grader.grade(question, essay, '9');

  assert.equal(band6.scores.total, band9.scores.total);
  assert.equal(calls.primary, 1);
  assert.equal(calls.review, 1);
  assert.equal(calls.sample, 2);
});

test('A temporary citation-repair outage does not lock a recoverable essay for a minute', async () => {
  let primaryCalls = 0, repairCalls = 0;
  const grader = createEssayGrader(async prompt => {
    if (prompt.startsWith('Repair ONLY')) {
      repairCalls++; throw Object.assign(Error('Provider unavailable'), { status: 503 });
    }
    if (prompt.startsWith('Independently review ONLY')) return review;
    if (prompt.startsWith('The original essay has already been scored.')) return {
      sampleStatus: 'ready', sampleResponse: essay, sampleSourceIdeas: ['Public transport helps cities move people efficiently'], sampleNote: '' };
    primaryCalls++;
    if (primaryCalls <= 2) {
      const raw = structuredClone(primary); raw.promptCoverage[0].evidence = 'Unsupported text';
      raw.promptCoverage[0].evidence_span = []; return raw;
    }
    return primary;
  });
  await assert.rejects(grader.grade('Discuss transport priorities.', essay), error => error.retryable !== false);
  assert.equal((await grader.grade('Discuss transport priorities.', essay)).scores.total, 23);
  assert.equal(primaryCalls, 3); assert.equal(repairCalls, 2);
});

test('exhausted evidence repair suppresses identical submissions without publishing a score', async () => {
  let calls = 0;
  const grader = createEssayGrader(async prompt => {
    calls++;
    if (prompt.startsWith('Repair ONLY')) return { repairs: [] };
    const raw = structuredClone(primary);
    raw.promptCoverage[0].evidence = 'Invented unsupported passage';
    raw.promptCoverage[0].evidence_span = [];
    return raw;
  });
  const question = 'Discuss transport priorities.';
  await assert.rejects(grader.grade(question, essay), error => error.retryable === false);
  await assert.rejects(grader.grade(question, essay), error => error.retryable === false);
  assert.equal(calls, 4);
});

test('an unsupported review judgement gets one reassessment and still requires a resolver for disagreement', async () => {
  const calls = [];
  const missing = { requirement: 'personal experience', status: 'missing', evidence_span: [],
    nextStep: 'Describe a personal journey that supports your position.' };
  const decision = structuredClone(review);
  decision.scores.content = 3;
  decision.promptCoverage.push(missing);
  decision.rationale = { content: 'The requested personal experience is missing.', linguistic: 'Good range.', coherence: 'Well organised.' };
  const grader = createEssayGrader(async (prompt, options) => {
    calls.push(options?.stage || 'sample');
    if (options?.stage === 'assessment') return primary;
    if (options?.stage === 'evidence-repair') return { repairs: [] };
    if (options?.stage === 'subjective-resolver') return decision;
    if (options?.stage === 'subjective-review') {
      if (calls.filter(stage => stage === 'subjective-review').length === 1) {
        const unsupported = structuredClone(review);
        unsupported.promptCoverage.push({ ...missing, status: 'partial' });
        return unsupported;
      }
      assert.match(prompt, /Independently reassess the original essay/);
      return decision;
    }
    return { sampleStatus: 'ready', sampleResponse: essay,
      sampleSourceIdeas: ['Public transport helps cities move people efficiently'], sampleNote: '' };
  });
  const result = await grader.grade('Discuss transport priorities. Include a personal experience.', essay);
  assert.deepEqual(calls, ['assessment', 'subjective-review', 'evidence-repair', 'subjective-review', 'subjective-resolver', 'sample']);
  assert.equal(result.scores.content, 3);
  assert.equal(result.scores.total, 21);
  assert.equal(result.promptCoverage[1].status, 'missing');
  assert.equal(result.promptCoverage[1].evidence, '');
  assert.equal(result.subjectiveReview.source, 'resolver');
});

test('persistent invalid second review never publishes a primary-only score and duplicate calls are suppressed', async () => {
  const calls = [];
  const grader = createEssayGrader(async (_prompt, options) => {
    calls.push(options.stage);
    if (options.stage === 'assessment') return primary;
    if (options.stage === 'evidence-repair') return { repairs: [] };
    const unsupported = structuredClone(review);
    unsupported.promptCoverage[0].evidence = 'Invented unsupported passage';
    unsupported.promptCoverage[0].evidence_span = [];
    return unsupported;
  });
  const question = 'Discuss transport priorities.';
  await assert.rejects(grader.grade(question, essay), error => error.retryable === false);
  await assert.rejects(grader.grade(question, essay), error => error.retryable === false);
  assert.deepEqual(calls, ['assessment', 'subjective-review', 'evidence-repair', 'subjective-review', 'evidence-repair']);
});
