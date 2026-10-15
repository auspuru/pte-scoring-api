'use strict';

// Tool output controls serialization, not the judgement. Word bounds,
// quotation validity, score/evidence consistency and independent review remain
// the responsibility of the existing essay validators.
const text = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false,
  properties, required: Object.keys(properties) });
const texts = { type: 'array', items: text };
const span = { type: 'array', items: { type: 'integer' },
  description: 'Exactly two 1-based inclusive word numbers from the ORIGINAL student essay; [] only for missing prompt coverage or off_topic relevance.' };
const citation = object({ span: { $ref: '#/$defs/span' } });
const citations = { type: 'array', items: { $ref: '#/$defs/citation' } };
const coverage = object({ requirement: text,
  status: { type: 'string', enum: ['addressed', 'partial', 'missing'] },
  evidence_span: { $ref: '#/$defs/span' },
  nextStep: { ...text, description: 'A specific action for partial or missing requirements; empty for addressed.' } });
const traits = ['content', 'linguistic', 'coherence'];
const score = max => ({ $ref: '#/$defs/score' + max });
const maxima = require('./public/essay-scoring').MAXIMA;
const scores = keys => object(Object.fromEntries(keys.map(key => [key, score(maxima[key])])));
const reasons = keys => object(Object.fromEntries(keys.map(key => [key, text])));
const common = {
  taskRelevance: object({ status: { type: 'string', enum: ['relevant', 'minimal', 'off_topic'], description:'relevant includes partial, thin or poorly focused responses with actual topical substance. minimal is an isolated topical assertion amid otherwise unrelated material and requires Content exactly 1. Never use minimal as a synonym for partial coverage while assigning Content 2 or higher. off_topic requires Content 0.' },
    evidence_span: { $ref: '#/$defs/span' },
    reason: { ...text, description: 'Explain the connection to the actual topic. off_topic requires empty evidence_span and Content 0; nonzero relevance needs substantive original essay evidence.' } }),
  promptCoverage: { type: 'array', items: { $ref: '#/$defs/coverage' } },
  scoringEvidence: object({ linguisticExamples: citations, developmentEvidence: citations })
};
const definitions = { span, citation, coverage,
  score2: { type: 'integer', description: 'Integer score from 0 to 2; enforced by the server.' },
  score6: { type: 'integer', description: 'Integer score from 0 to 6; enforced by the server.' } };
const primary = object({ scores: scores(Object.keys(maxima)), ...common,
  scoringEvidence: object({ ...common.scoringEvidence.properties, vocabularyExamples: citations }),
  feedback: reasons(Object.keys(maxima)),
  errors: { type: 'array', items: object({
    type: { type: 'string', enum: ['grammar', 'spelling'] },
    phrase_span: { $ref: '#/$defs/span' }, correction: text,
    impact: { type: 'string', enum: ['minor', 'meaning'] }, explanation: text
  }) },
  optionalRefinements: { type: 'array', items: object({
    phrase_span: { $ref: '#/$defs/span' }, correction: text, explanation: text
  }) },
  templateDetector: { type: 'string', enum: ['good', 'ok', 'flag'] },
  templateNote: text, templateEvidence: texts, strengths: texts,
  improvements: texts, overallVerdict: text
});
const review = object({ scores: scores(traits), ...common, rationale: reasons(traits) });
const resolver = object({ ...review.properties,
  candidateRelevance: object({ status: { type: 'string', enum: ['substantive', 'generic', 'unrelated', 'none'] },
    reason: { ...text, description: 'Judge the supplied candidate assertion in isolation against the actual topic, before assessing completion of the full task. none only when no candidate is supplied.' } }) });
const repair = object({ repairs: { type: 'array', items: object({
  path: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
  span: { $ref: '#/$defs/span' }
}) } });
const schemas = { assessment: primary, 'subjective-review': review, 'subjective-resolver': resolver, 'evidence-repair': repair };

const feedbackIssue = object({code:{type:'string',enum:require('./public/essay-feedback').CODES}, category:{type:'string',enum:['coverage','reasoning','relevance','organisation','language']},
  priority:{type:'string',enum:['major','minor','optional']}, requirementId:text,
  trait:{type:'string',enum:['content','linguistic','coherence','vocabulary']}, affectsScore:{type:'boolean'},
  evidence:object({essay_span:span,promptQuote:text}), explanation:text,suggestedChange:text,scoreRationale:text});
const revisionDecision = object({priorIssueId:text,status:{type:'string',enum:['resolved','open','needs_clarification']},currentIssueCode:text,evidence_span:span,reason:text});
const feedbackRepair=object({feedbackIssues:{type:'array',items:feedbackIssue},revisionDecisions:{type:'array',items:revisionDecision},rationale:reasons(traits),strengths:texts,overallVerdict:text});
schemas['feedback-repair']=feedbackRepair;
function toolFor(stage, {feedbackV3=false} = {}) {
  let schema = schemas[stage];
  if (schema && feedbackV3 && !['evidence-repair','feedback-repair'].includes(stage)) {
    schema = object({...schema.properties,
      feedbackIssues:{type:'array',items:feedbackIssue,description:'Authoritative specific corrections, not generic improvement tips. Required for each missing or partial canonical requirement and actual material weaknesses. Each scoring issue must explain the actual gap using current evidence. Return [] when no genuine correction is needed, even if a holistic language-range mark is not perfect. Do not invent weaknesses or demand extra sentence techniques to populate this array.'}, revisionDecisions:{type:'array',items:revisionDecision},
      ...(stage==='assessment' ? {} : {strengths:texts,overallVerdict:text})});
  }
  if (!schema) return null;
  return {
    name: 'submit_essay_' + stage.replace(/-/g, '_'),
    // The complete primary schema exceeds the provider's strict grammar limit.
    // It still uses a forced tool and all existing server validation. Smaller
    // independent reviews and citation repairs support strict decoding.
    ...(stage === 'assessment' || (feedbackV3 && !['evidence-repair','feedback-repair'].includes(stage)) ? {} : { strict: true }),
    description: 'Return complete essay assessment data under the supplied rubric, including empty arrays where appropriate. This tool performs no external action. Cite only original student words. A missing requirement has status missing and an empty evidence_span; never invent evidence to satisfy a judgement. Keep all fields separate; never embed JSON fields inside feedback strings.',
    input_schema: { ...schema, $defs: {...definitions, ...(feedbackV3 ? {coverage:object({...coverage.properties,requirementId:text})} : {})} }
  };
}

function request(prompt, model, options = {}) {
  const tool = toolFor(options.stage, options);
  return { model, temperature: 0, max_tokens: options.feedbackV3 ? 9000 : 6000,
    messages: [{ role: 'user', content: prompt }],
    ...(tool ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name } } : {}) };
}

function response(value, { stage } = {}) {
  if (value?.stop_reason === 'max_tokens') {
    const error = new Error('Incomplete essay assessment'); error.code = 'ESSAY_TRUNCATED'; throw error;
  }
  const tool = toolFor(stage);
  if (tool) {
    const input = value?.content?.find(part => part.type === 'tool_use' && part.name === tool.name)?.input;
    if (input && typeof input === 'object' && !Array.isArray(input)) return input;
    const error = new Error('Missing structured essay assessment'); error.code = 'ESSAY_OUTPUT_FORMAT'; throw error;
  }
  // Sample generation retains its separate contract and cannot change scores.
  const raw = (value?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || 'null');
}

module.exports = { toolFor, request, response };
