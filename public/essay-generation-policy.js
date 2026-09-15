(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.EssayGenerationPolicy = policy;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function outputMode(plan) {
    if (plan.target_band_level !== 'band6') return 'full_essay';
    if (plan.output_mode) return plan.output_mode === 'idea_guide' ? 'idea_guide' : 'full_essay';
    return plan.band6Mode === 'just_phrases' ? 'idea_guide' : 'full_essay';
  }
  function containsPlanningNotes(text) {
    return /(?:^|\n)\s*(?:#{1,4}\s*|\*\*)?(?:idea\s*\d+|explanation|example\s+phrases|supporting\s+reason\s*\d+)\s*(?:\*\*)?\s*:/i.test(text || '') ||
      /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/.test(text || '');
  }
  function validateFormat(plan, text) {
    const errors = [], sections = {};
    const names = ['INTRO', 'BP1', 'BP2', 'CONCL'];
    const positions = names.map(name => String(text || '').indexOf('===' + name + '==='));
    if (positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1])) ||
        names.some(name => String(text || '').split('===' + name + '===').length !== 2)) {
      return { ok: false, errors: ['Return exactly one introduction, two body paragraphs and one conclusion in the required section order.'], sections };
    }
    names.forEach((name, index) => {
      const paragraph = text.slice(positions[index] + name.length + 6, index < 3 ? positions[index + 1] : undefined).trim();
      sections[name.toLowerCase()] = paragraph;
      if (paragraph.length < 15) errors.push(name + ' is empty or unfinished.');
      if (outputMode(plan) === 'full_essay' && containsPlanningNotes(paragraph)) {
        errors.push(name + ' contains planning notes or a list. Write connected, complete sentences in a finished essay paragraph; omit Idea, Explanation and Example Phrases labels.');
      }
    });
    return { ok: errors.length === 0, errors, sections };
  }
  return { outputMode, containsPlanningNotes, validateFormat };
});
