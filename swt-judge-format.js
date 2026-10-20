'use strict';
// Keep the full assessment contract explicit and recover misplaced annotation
// data before the independent scoring/evidence validator checks completeness.
const text = { $ref: '#/$defs/text' };
// Strict decoding supports types, required fields and enums. Word bounds and
// the two-number span length are still enforced by materialiseEvidence.
const span = { type: 'array', items: { type: 'integer' },
  description: 'First and last word numbers, 1-based inclusive, from the numbered student response. Never cite the passage.' };
const annotation = { type: 'object', additionalProperties: false, properties: {
  phrase_span: span, fix: text, severity: { type: 'string', enum: ['minor', 'major'] }, type: text,
  meaning_impact: { type: 'string', enum: ['none', 'changed', 'obscured'] },
  meaning_effect: { ...text, description: 'Specific effect on meaning for changed/obscured; otherwise empty.' }, rationale: text
}, required: ['phrase_span', 'fix', 'severity', 'type', 'meaning_impact', 'meaning_effect', 'rationale'] };
const tool = {
  name: 'submit_swt_assessment',
  strict: true,
  description: 'Return the complete SWT assessment under the supplied scoring policy. Evaluate meaning and language independently of the output format. Supply every required property, including a nonempty relationship explanation and empty annotation arrays when no corrections are needed. Cite student evidence using the numbered words; do not rewrite quotations. This tool returns assessment data and performs no external action.',
  // Reuse repeated structures: inlining both annotation schemas exceeds the
  // provider's compiled-grammar limit despite having no optional fields.
  input_schema: { type: 'object', additionalProperties: false, $defs: { span, annotation, text: { type: 'string' } }, properties: {
    content_score: { type: 'number', description: 'Content score from 0 to 4.' },
    grammar_score: { type: 'number', description: 'Grammar score from 0 to 2.' },
    vocabulary_score: { type: 'number', description: 'Vocabulary score from 0 to 2.' },
    cohesion: { type: 'string', enum: ['strong', 'adequate', 'weak'] },
    summary_assessment: { type: 'object', additionalProperties: false, properties: {
      synthesis_source_span: { $ref: '#/$defs/span', description: 'Two SOURCE word numbers for one short clause that the student usefully compressed or recast. Cite a clause, not the whole passage or several paragraphs. [] allowed for partial/limited only.' },
      synthesis_span: { $ref: '#/$defs/span' },
      synthesis_operation: { ...text, description: 'Exactly clause_recast, compression, selection_only, word_substitution_only or none. Removing sentence stops, inserting connectors, and isolated synonym swaps are not clause_recast or compression. Cite the changed student phrase in synthesis_span; punctuation changes alone are insufficient.' },
      synthesis_quality: { ...text, description: 'Exactly effective, partial or limited. Effective requires a real useful clause_recast/compression shown by the source quote and student span; accuracy and connections alone do not establish reformulation.' },
      main_idea_accurate: { type: 'boolean' },
      main_idea_span: { type: 'array', items: { type: 'integer' },
        description: 'Two inclusive student word numbers, or [] if no accurate main idea is present.' },
      supporting_spans: { type: 'array', items: { $ref: '#/$defs/span' } },
      conclusion_status: { type: 'string', enum: ['captured', 'clearly_implied', 'not_applicable', 'missing', 'incorrect'] },
      relationships_clear: { type: 'boolean' }, material_meaning_change: { type: 'boolean' },
      // A compact wire contract avoids the provider's strict-grammar limit.
      // The server materialises the public synthesis object and exact quote.
      missing_dependencies: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        effect: text, missing_context: text, explanation: text
      }, required: ['effect', 'missing_context', 'explanation'] } },
      relationship_explanation: { type: 'string', description: 'In 1–2 short sentences explain both the relationships and synthesis. A deduction needs a specific evidenced weakness, not a synonym count.' },
      next_step: text, repair: text
    }, required: ['synthesis_source_span', 'synthesis_span', 'synthesis_operation', 'synthesis_quality', 'main_idea_accurate', 'main_idea_span', 'supporting_spans', 'conclusion_status', 'relationships_clear', 'material_meaning_change', 'missing_dependencies', 'relationship_explanation', 'next_step', 'repair'] },
    grammar_annotations: { type: 'array', items: { $ref: '#/$defs/annotation' } },
    vocabulary_annotations: { type: 'array', items: { $ref: '#/$defs/annotation' } },
    captured_ideas: { type: 'array', items: text, description: 'Diagnostic labels present in the response: choose only supplied what, why, how, result, topic, pivot, conclusion; [] when none. These labels never determine holistic Content.' },
    recommended_swaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      word: text, synonyms: { type: 'array', items: text }
    }, required: ['word', 'synonyms'] } },
    feedback_note: { ...text, description: 'Plain student-facing feedback only. This is the final field; never place other JSON fields inside this string.' }
  }, required: ['content_score', 'grammar_score', 'vocabulary_score', 'cohesion', 'summary_assessment', 'grammar_annotations', 'vocabulary_annotations', 'captured_ideas', 'recommended_swaps', 'feedback_note'] }
};
function request(prompt, model, {semanticReassessment=false} = {}) {
  return { model:semanticReassessment ? (process.env.CLAUDE_REASSESSMENT_MODEL || 'claude-sonnet-4-6') : model, max_tokens: 4000, temperature: 0, tools: [tool],
    tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: prompt
      + '\n\nOUTPUT CHECK: grammar_annotations and vocabulary_annotations must be separate top-level arrays, including [] when no corrections are needed. Return these arrays before feedback_note. Keep relationship_explanation under 60 words, next_step to one achievable action, and recommended_swaps to at most three useful optional suggestions. Write feedback_note last as short plain feedback, never as escaped JSON containing other fields.' }] };
}

const feedbackFields = ['grammar_annotations', 'vocabulary_annotations', 'recommended_swaps'];
function recoverFeedbackFields(result) {
  if (typeof result.feedback_note !== 'string' || result.feedback_note.length > 20000
    || (Array.isArray(result.grammar_annotations) && Array.isArray(result.vocabulary_annotations))) return result;
  // The provider can accidentally escape the remaining JSON fields into the
  // feedback string. Recover only an entire, parseable suffix containing the
  // known array fields. Never invent empty arrays, scores, flags or evidence.
  let candidate = result.feedback_note;
  for (let depth = 0; depth < 3; depth++) {
    const marker = /",\s*(?="(?:grammar_annotations|vocabulary_annotations|recommended_swaps)"\s*:)/.exec(candidate);
    if (marker) {
      const tail = candidate.slice(marker.index + 2).trim();
      for (const json of ['{' + tail + '}', '{' + tail]) {
        try {
          const fields = JSON.parse(json), names = Object.keys(fields);
          if (!names.length || names.some(name => !feedbackFields.includes(name) || !Array.isArray(fields[name]))) continue;
          // Explicit top-level fields remain authoritative, including malformed
          // ones. Conflicting duplicate data requires the usual model retry.
          if (names.some(name => Object.hasOwn(result, name) && JSON.stringify(result[name]) !== JSON.stringify(fields[name]))) continue;
          const recovered = { ...result, ...fields };
          if (!Array.isArray(recovered.grammar_annotations) || !Array.isArray(recovered.vocabulary_annotations)) continue;
          return { ...recovered, feedback_note: candidate.slice(0, marker.index).trim(), annotation_format_recovered: true };
        } catch (_) { /* Incomplete or ambiguous data stays unconfirmed. */ }
      }
    }
    const escapes = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t' };
    const decoded = candidate.replace(/\\(["\\/nrt])/g, (_, value) => escapes[value]);
    if (decoded === candidate) break;
    candidate = decoded;
  }
  return result;
}

function response(value) {
  if (value?.stop_reason === 'max_tokens') {
    const error = new Error('Incomplete SWT assessment'); error.code = 'SWT_TRUNCATED'; throw error;
  }
  const result = value?.content?.find(part => part.type === 'tool_use' && part.name === tool.name)?.input;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const recovered = recoverFeedbackFields(result);
  const labels = ['what', 'why', 'how', 'result', 'topic', 'pivot', 'conclusion'];
  return { ...recovered, ...(Array.isArray(recovered.captured_ideas)
    ? {per_idea_scores:Object.fromEntries(labels.map(label=>[label,recovered.captured_ideas.includes(label)?1:0]))} : {}), source:'claude' };
}
module.exports = { tool, request, response };
