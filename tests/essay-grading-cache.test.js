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
  scores: { content: 5, spelling: 2, grammar: 2, vocabulary: 2, linguistic: 5, coherence: 5 },
  feedback: {
    content: 'Relevant and developed.',
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
