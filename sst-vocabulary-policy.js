'use strict';

const VERSION = 'sst-vocabulary-accuracy-1';
const GUIDANCE = 'Vocabulary 2 appropriate word choice, 1 genuine word-choice or usage errors that leave the intended meaning clear, 0 word choice that could hinder understanding. Simple accurate words, repetition of necessary terms and accurate wording from the lecture can earn full Vocabulary marks. Judge how the words fit the context. Leave out optional style or synonym suggestions. A Vocabulary deduction must quote the exact words, give a correction and explain the error in plain English. For vocabulary errors in errors, add "trait":"vocabulary" and "communicationHindered":true or false. Use true only if the word choice could make the intended meaning hard to understand.';

function assess(errors) {
  const evidence = errors.filter(item => item.trait === 'vocabulary'
    && typeof item.communicationHindered === 'boolean'
    && item.explanation.trim() && item.correction.trim()
    && item.correction.trim().toLowerCase() !== item.phrase.trim().toLowerCase());
  const score = evidence.some(item => item.communicationHindered) ? 0 : evidence.length ? 1 : 2;
  return {
    score,
    feedback: evidence.length ? evidence.map(item => item.explanation.trim()).join(' ')
      : 'The words fit the meaning. Simple, accurate wording and suitable phrases from the lecture can earn full marks.',
    errors: errors.filter(item => item.trait !== 'vocabulary' || evidence.includes(item))
  };
}

module.exports = { VERSION, GUIDANCE, assess };
