'use strict';
// Required fields prevent a missing explanation or annotation property from
// turning an otherwise assessed mock response into a provisional result.
const text = { type: 'string' };
const span = { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 2, maxItems: 2,
  description: 'First and last word numbers, 1-based inclusive, from the numbered student response. Never cite the passage.' };
const annotation = { type: 'object', properties: {
  phrase_span: span, fix: text, severity: { type: 'string', enum: ['minor', 'major'] }, type: text,
  meaning_impact: { type: 'string', enum: ['none', 'changed', 'obscured'] },
  meaning_effect: { ...text, description: 'Specific effect on meaning for changed/obscured; otherwise empty.' }, rationale: text
}, required: ['phrase_span', 'fix', 'severity', 'type', 'meaning_impact', 'meaning_effect', 'rationale'] };
const tool = {
  name: 'submit_swt_assessment',
  description: 'Return the complete SWT assessment under the supplied scoring policy. Evaluate meaning and language independently of the output format. Supply every required property, including a nonempty relationship explanation and empty annotation arrays when no corrections are needed. Cite student evidence using the numbered words; do not rewrite quotations. This tool returns assessment data and performs no external action.',
  input_schema: { type: 'object', properties: {
    content_score: { type: 'number', minimum: 0, maximum: 4 },
    grammar_score: { type: 'number', minimum: 0, maximum: 2 },
    vocabulary_score: { type: 'number', minimum: 0, maximum: 2 },
    cohesion: { type: 'string', enum: ['strong', 'adequate', 'weak'] },
    summary_assessment: { type: 'object', properties: {
      main_idea_accurate: { type: 'boolean' },
      main_idea_span: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 2,
        description: 'Two inclusive student word numbers, or [] if no accurate main idea is present.' },
      supporting_spans: { type: 'array', items: span },
      conclusion_status: { type: 'string', enum: ['captured', 'clearly_implied', 'not_applicable', 'missing', 'incorrect'] },
      relationships_clear: { type: 'boolean' }, material_meaning_change: { type: 'boolean' },
      missing_dependencies: { type: 'array', items: { type: 'object', properties: {
        effect: text, missing_context: text, explanation: text
      }, required: ['effect', 'missing_context', 'explanation'] } },
      relationship_explanation: { type: 'string', minLength: 1, description: 'Explain the connections that are preserved or the necessary context missing from this response. Always provide an explanation.' },
      next_step: text, repair: text
    }, required: ['main_idea_accurate', 'main_idea_span', 'supporting_spans', 'conclusion_status', 'relationships_clear', 'material_meaning_change', 'missing_dependencies', 'relationship_explanation', 'next_step', 'repair'] },
    grammar_annotations: { type: 'array', items: annotation },
    vocabulary_annotations: { type: 'array', items: annotation },
    per_idea_scores: { type: 'object', additionalProperties: { type: 'number', enum: [0, 1] } },
    academic_register: { type: 'boolean' }, feedback_note: text,
    recommended_swaps: { type: 'array', items: { type: 'object', properties: {
      word: text, context: text, synonyms: { type: 'array', items: text }, rationale: text
    }, required: ['word', 'context', 'synonyms', 'rationale'] } }
  }, required: ['content_score', 'grammar_score', 'vocabulary_score', 'cohesion', 'summary_assessment', 'grammar_annotations', 'vocabulary_annotations', 'per_idea_scores', 'feedback_note'] }
};
function request(prompt, model) {
  return { model, max_tokens: 4000, temperature: 0, tools: [tool],
    tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: prompt }] };
}
function response(value) {
  if (value?.stop_reason === 'max_tokens') {
    const error = new Error('Incomplete SWT assessment'); error.code = 'SWT_TRUNCATED'; throw error;
  }
  const result = value?.content?.find(part => part.type === 'tool_use' && part.name === tool.name)?.input;
  return result && typeof result === 'object' && !Array.isArray(result) ? { ...result, source: 'claude' } : null;
}
module.exports = { tool, request, response };
