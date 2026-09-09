/* Shared, deterministic presentation of SWT feedback. No scoring decisions here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwtStudentFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const list = value => Array.isArray(value) ? value : [];
  function build(data) {
    const traits = data.trait_scores || {};
    const content = data.content_details || {};
    const assessment = content.summary_assessment || {};
    const grammar = list((data.grammar_details || {}).grammar_annotations);
    const vocabulary = list((data.vocabulary_details || {}).vocabulary_annotations);
    const provisional = data.score_provisional === true || data.ai_feedback_degraded === true;
    const formValid = Number(traits.form) >= 1;
    const full = formValid && !provisional && Number(traits.content) >= (traits.content_max || 4)
      && Number(traits.grammar) >= 2 && Number(traits.vocabulary) >= 2;
    const priorities = [];
    const optional = [];
    const add = (title, detail) => priorities.push({ title, detail });
    const languageDetail = (annotations, fallback) => {
      const issues = annotations.filter(a => a && a.affects_score === true && clean(a.meaning_effect));
      return issues.slice(0, 2).map(a => '“' + clean(a.phrase) + '” → “' + clean(a.fix) + '”. ' + clean(a.meaning_effect)).join(' ') || fallback;
    };
    if (!formValid) {
      add('Make it one sentence within 5–75 words', clean((data.form_details || {}).reason) || 'Join your ideas into one complete sentence, check the word count, and end with sentence punctuation.');
    } else if (provisional) {
      add('Request a complete assessment', 'The meaning and connections could not be fully assessed. Submit again before using these provisional scores to guide a revision.');
    } else {
      if (Number(traits.content) < (traits.content_max || 4)) {
        const dependencies = list(assessment.missing_dependencies).filter(d => d && clean(d.missing_context));
        if (dependencies.length) {
          const first = dependencies[0];
          add('Connect the idea to its missing context', (clean(first.effect) ? 'Your phrase “' + clean(first.effect) + '” needs this context: ' : '') + clean(first.missing_context) + (clean(first.explanation) ? ' ' + clean(first.explanation) : ''));
        } else {
          add(['missing', 'incorrect'].includes(assessment.conclusion_status) ? 'Include the passage’s final message' : 'Strengthen the main idea and its connections',
            clean(content.notes) || clean(content.feedback_note) || 'Check that the main idea, relevant support and conclusion connect clearly. Include any cause or background your selected ideas depend on.');
        }
      }
      if (Number(traits.grammar) < 2) add('Correct the grammar affecting meaning', languageDetail(grammar, 'Review the grammar explanation and the highlighted wording. A deduction should identify how the sentence changes or obscures the intended meaning.'));
      if (Number(traits.vocabulary) < 2) add('Use wording that preserves the meaning', languageDetail(vocabulary, 'Review the highlighted word choices against the passage. Replace any wording that changes the original message.'));
      if (full) add('Keep this approach', 'You have enough relevant content, clear connections and valid form for full marks. Try another passage, or review the optional refinements below if any are shown.');
      for (const a of [...grammar, ...vocabulary]) {
        if (!a || a.affects_score !== false || !clean(a.phrase) || !clean(a.fix)) continue;
        if (optional.some(item => item.phrase === a.phrase && item.fix === a.fix)) continue;
        optional.push({ phrase: clean(a.phrase), fix: clean(a.fix), reason: clean(a.rationale).replace(/^Optional refinement\s*[—–-]\s*no score deduction\.\s*/i, '') });
      }
    }
    const summary = !formValid ? 'The form requirements need attention before this response can receive a complete score.'
      : provisional ? 'This result is provisional. A complete assessment of meaning and connections is still needed.'
      : full ? 'Your summary captures the main message, relevant support and conclusion with clear connections. Minor slips that preserve meaning do not reduce your marks.'
      : clean(content.notes) || clean(content.feedback_note) || 'Review the priorities below to see what held this response back and what to change next.';
    return { summary, priorities: priorities.slice(0, 3), optional: optional.slice(0, 8), full, provisional, formValid };
  }
  // Recompute presentation from traits, including previously saved attempts.
  // Never trust a historical band label or a raw total as proof of completeness.
  function presentation(data) {
    const feedback = build(data);
    const t = data.trait_scores || {};
    const content = Math.max(0, Math.min(4, Number(t.content) || 0));
    const raw = ['content', 'form', 'grammar', 'vocabulary'].reduce((n, k) => n + (Number(t[k]) || 0), 0);
    const caps = [15, 38, 65, 79, 90];
    const estimate = Math.min(Number(data.overall_score) || 0, caps[Math.floor(content)]);
    let headline = feedback.full ? 'Complete, well-connected summary' : 'Review the language affecting meaning';
    if (!feedback.formValid) headline = 'Form requirements not met';
    else if (feedback.provisional) headline = 'Provisional result';
    else if (content <= 1) headline = 'Incomplete summary — limited content';
    else if (content <= 2) headline = 'Incomplete summary — key ideas or connections missing';
    else if (content < 4) headline = 'Mostly complete — strengthen the missing connection';
    const focusContent = feedback.formValid && content < 4;
    return { headline, score: focusContent ? content : raw, max: focusContent ? 4 : 9,
      label: focusContent ? 'Content score' : 'Trait total', raw, estimate,
      secondary: feedback.provisional ? 'Assessment incomplete — submit again for a confirmed result.'
        : (focusContent ? 'Trait total: ' + raw + ' / 9 · ' : '') + 'PTE estimate: ' + estimate + ' / 90' };
  }
  return { build, presentation };
});

