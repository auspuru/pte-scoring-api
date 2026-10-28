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
    phrase_span: { $ref: '#/$defs/span' }, correction: {...text,description:'A nonempty corrected version of the quoted phrase. To remove an unnecessary word, quote enough surrounding original words and return the corrected phrase with that word removed; never use an empty correction.'},
    impact: { type: 'string', enum: ['minor', 'meaning'] }, explanation: text
  }) },
  optionalRefinements: { type: 'array', items: object({
    phrase_span: { $ref: '#/$defs/span' }, correction: text, explanation: text
  }) },
  templateDetector: { type: 'string', enum: ['good', 'ok', 'flag'] },
  templateNote: text, templateEvidence: texts,
  strengths: {...texts,description:'Up to three specific strengths grounded in ideas or wording actually present in the essay; avoid generic praise.'},
  improvements: texts, overallVerdict: {...text,description:'A brief student-facing assessment: one concrete strength and the most useful next improvement if justified. Preserve the viewpoint; describe ambiguous meaning as uncertain.'}
});
const review = object({ scores: scores(traits), ...common, rationale: reasons(traits) });
const resolver = object({ ...review.properties,
  candidateRelevance: object({ status: { type: 'string', enum: ['substantive', 'generic', 'unrelated', 'none'] },
    reason: { ...text, description: 'Judge the supplied candidate assertion in isolation against the actual topic, before assessing completion of the full task. none only when no candidate is supplied.' } }) });
const repair = object({ repairs: { type: 'array', items: object({
  path: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
  span: { $ref: '#/$defs/span' }
}) } });
const schemas = { assessment: primary, 'subjective-review': review, 'subjective-resolver': resolver, 'evidence-repair': repair, 'support-audit': require('./essay-support-audit').schema };

const feedbackIssue = object({code:{type:'string',enum:require('./public/essay-feedback').CODES}, category:{type:'string',enum:['coverage','reasoning','relevance','organisation','language']},
  priority:{type:'string',enum:['major','minor','optional']}, requirementId:text,
  trait:{type:'string',enum:['content','linguistic','coherence','vocabulary']}, affectsScore:{type:'boolean'},
  evidence:object({essay_span:{...span,description:'The shortest exact essay span that shows the issue; avoid quoting multiple paragraphs.'},promptQuote:text}),
  explanation:{...text,description:'Briefly identify the actual weakness. Credit relevant reasoning elsewhere; do not turn optional improvements into missing requirements.'},
  suggestedChange:{...text,description:'One short, achievable action in at most two sentences. If place did not determine success is a permitted position, one explicit link between early circumstances and achievement is enough advice; do not prescribe a researched list of regional political, economic or cultural mechanisms.'},scoreRationale:text});
const revisionDecision = object({priorIssueId:text,status:{type:'string',enum:['resolved','open','needs_clarification']},currentIssueCode:text,evidence_span:span,reason:text});
const feedbackRepair=object({feedbackIssues:{type:'array',items:feedbackIssue},revisionDecisions:{type:'array',items:revisionDecision},rationale:reasons(traits),strengths:texts,overallVerdict:text});
schemas['feedback-repair']=feedbackRepair;
schemas['organisation-review']=object({scores:scores(['coherence']),rationale:reasons(['coherence']),
  scoringEvidence:object({developmentEvidence:citations}),
  feedbackIssues:{type:'array',items:object({...feedbackIssue.properties,trait:{type:'string',enum:['coherence']},category:{type:'string',enum:['organisation']}})},
  revisionDecisions:{type:'array',items:revisionDecision}});
function toolFor(stage, {feedbackV3=false, requirements=[], previousIssueIds, supportReview=false} = {}) {
  let schema = schemas[stage];
  if (schema && feedbackV3 && !['evidence-repair','feedback-repair','organisation-review'].includes(stage)) {
    const issueSchema = stage === 'assessment' ? feedbackIssue : object({...feedbackIssue.properties,
      trait:{type:'string',enum:traits,description:'Review only Content, Linguistic Range and Coherence. Vocabulary, spelling and grammar belong to the primary assessment.'}});
    schema = object({...schema.properties,
      feedbackIssues:{type:'array',items:issueSchema,description:'Authoritative specific corrections, not generic improvement tips. Required for each missing or partial canonical requirement and actual material weaknesses. Each scoring issue must explain the actual gap using current evidence. Return [] when no genuine correction is needed, even if a holistic language-range mark is not perfect. Do not invent weaknesses or demand extra sentence techniques to populate this array.'}, revisionDecisions:{type:'array',items:revisionDecision},
      ...(stage==='subjective-resolver' ? {strengths:texts,overallVerdict:text} : {})});
  }
  if (!schema) return null;
  if(stage==='subjective-resolver' && supportReview && feedbackV3) {
    const {scores:scoreSchema,...evidenceFirst}=schema.properties;
    schema=object({...evidenceFirst,scores:object({...scoreSchema.properties,
      coherence:{...scoreSchema.properties.coherence,description:'0–6. A score of 4 or below requires a material progression or connection problem supported by a major, score-affecting Organisation issue with exact essay evidence. Clear logical structure with minor repetition or optional transitions fits 5. Do not invent an issue or force full marks.'}
    })});
  }
  if (feedbackV3 && Array.isArray(previousIssueIds) && schema.properties.revisionDecisions) {
    schema = {...schema,properties:{...schema.properties,revisionDecisions:{
      ...schema.properties.revisionDecisions,
      description:previousIssueIds.length
        ? 'Compare only these previous-attempt issue ids, one decision per id: '+JSON.stringify(previousIssueIds)
        : 'No previous attempt issues were supplied. Return [] exactly. Current assessment issues are not previous issues.',
      ...(previousIssueIds.length ? {items:object({...revisionDecision.properties,priorIssueId:{...text,enum:previousIssueIds}})} : {})
    }}};
  }
  const canonical = feedbackV3 && requirements.length ? requirements : null;
  const judgement = !['evidence-repair','feedback-repair'].includes(stage);
  if (canonical && schema.properties.feedbackIssues) {
    schema = {...schema,properties:{...schema.properties,feedbackIssues:{...schema.properties.feedbackIssues,
      items:object({...schema.properties.feedbackIssues.items.properties,requirementId:{...text,enum:['',...canonical.map(r=>r.id)]}})}}};
  }
  if (canonical && judgement && schema.properties.promptCoverage) {
    schema = {...schema, properties:{...schema.properties,
      promptCoverage:{...schema.properties.promptCoverage, minItems:canonical.length, maxItems:canonical.length,
        description:'Return exactly one entry per supplied canonical requirement, each id exactly once. Assess all parts within a grouped requirement together; do not split it into new ids. Canonical id and exact label pairs: '+JSON.stringify(canonical.map(({id,label})=>({id,label})))}}};
  }
  return {
    name: 'submit_essay_' + stage.replace(/-/g, '_'),
    // The complete primary schema exceeds the provider's strict grammar limit.
    // It still uses a forced tool and all existing server validation. Smaller
    // independent reviews and citation repairs support strict decoding.
    ...(stage === 'assessment' || (feedbackV3 && !['evidence-repair','feedback-repair'].includes(stage)) ? {} : { strict: true }),
    description: 'Return complete essay assessment data under the supplied rubric, including empty arrays where appropriate. This tool performs no external action. Cite only original student words. A missing requirement has status missing and an empty evidence_span; never invent evidence to satisfy a judgement. Keep all fields separate; never embed JSON fields inside feedback strings.',
    input_schema: { ...schema, $defs: {...definitions, ...(feedbackV3 ? {coverage:object({...coverage.properties,
      ...(canonical && judgement ? {requirement:{...text,enum:canonical.map(r=>r.label)}} : {}),
      requirementId:canonical && judgement ? {...text,enum:canonical.map(r=>r.id)} : text})} : {})} }
  };
}

function request(prompt, model, options = {}) {
  const tool = toolFor(options.stage, options);
  if (tool && !['evidence-repair','feedback-repair','support-audit'].includes(options.stage)) prompt += '\n\nCONCISE OUTPUT: Return the complete structured assessment with short, specific explanations. Use one sentence per trait rationale, issue explanation, suggested change and verdict where sufficient; do not repeat the same advice across fields. Cite only the shortest useful supporting spans. Include every genuine distinct correction and every canonical requirement; do not invent extra issues or optional rewrites to fill the response. Independent review and resolution assess only Content, Linguistic Range and Coherence, leaving primary spelling, grammar and vocabulary unchanged.';
  return { model:modelFor(model,options,process.env.CLAUDE_REASSESSMENT_MODEL || 'claude-sonnet-4-6'), temperature: 0, max_tokens: ['support-audit','organisation-review'].includes(options.stage) ? 2400 : options.feedbackV3 ? 9000 : 6000,
    messages: [{ role: 'user', content: prompt }],
    ...(tool ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name } } : {}) };
}

function essayModel(env = process.env) {
  // Essay assessment has its own model, independent of the general chat proxy.
  return env.ESSAY_CLAUDE_MODEL || 'claude-sonnet-4-6';
}

function modelFor(model, options = {}, reassessmentModel = 'claude-sonnet-4-6') {
  return options.supportReview || (options.feedbackV3 && options.semanticReassessment) ? reassessmentModel : model;
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

module.exports = { toolFor, request, response, modelFor, essayModel };
