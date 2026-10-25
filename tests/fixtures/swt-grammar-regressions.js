'use strict';
const geothermal = require('../../content/user-swt-predictions-oct23').find(p => p.title === 'Geothermal Energy');
const original = "The geothermal energy is the solution for increasing energy demands; moreover, 60% of Kenya's power comes from hydroelectric sources but these are proving increasingly unreliable; and alternative energy sources are needed; furthermore, locals have been utilizing geothermal energy for centuries in various ways; additionally, tectonic stretching of the crust results in higher temperatures, and this phenomenon works for geothermal wells as water is converted into steam, which used to drive turbines and produce electricity.";
const p = { text: geothermal.text, keyElements: geothermal.keyElements };
module.exports = [
  { name: 'Geothermal recoverable missing auxiliary', p, text: original, minimum: 3, grammar: 2,
    forbiddenLanguageFeedback: 'reads as.{0,100}formerly|reversing the intended meaning' },
  { name: 'Geothermal corrected auxiliary', p, text: original.replace('which used to', 'which is used to'), minimum: 3, grammar: 2 },
  { name: 'Geothermal explicit discontinued mechanism negative', p,
    text: 'East Africa can no longer use geothermal heat to generate electricity because underground steam formerly drove turbines but no longer does.',
    full: false, max: 2, grammar: 2 }
];
