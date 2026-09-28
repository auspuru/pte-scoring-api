'use strict';

const source = {
  provider: 'User supplied WFD predictions',
  week: '28 September 2026',
  checkedAt: '2026-09-28',
  lastReviewed: '2026-09-28',
  contentStatus: 'verbatim-user-provided'
};

const sentences = [
  "Our professor is hosting the business development conference.",
  "Unemployment rate has fallen to lowest its level in years",
  "The use of mobile phones is not permitted in the library",
  "Food containing ample calories provides little or no nutritional value",
  "A massive accumulation of data was converted into a communicable argument",
  "An administrative guide is available from the main office",
  "Collaboration between departments is a feature of successful companies",
  "The economic strength of early Roman Republic will be examined",
  "He has landed a job in a very prestigious law firm",
  "Classical mechanics is sometimes considered as a branch of applied mathematics",
  "The course involves a combination of pure and applied mathematics",
  "When the root system of a plant fails, foliage suffers",
  "While some people regard it as reforming zeal, others regard it as recklessness",
  "Mixtures are defined as the compound of chemically separate parts",
  "All experimental procedures are outlined in the laboratory manual",
  "Polar regions islands are ideal for meteorologists and astrophysicists",
  "Muscle cells bring parts of the body closer together",
  "Dealing with the growing population is a challenge for many governments",
  "They developed a unique approach to training their employees",
  "Her design incorporates the best aspects of vernacular architecture",
  "It is quite clear that our facial expressions are similar across different cultures",
  "This class teaches you the importance of planning your essays",
  "Coursework gives students the chance to thoroughly explore the subject",
  "Chemical reactions occur when substances combine or change form",
  "Mathematics provides a foundation for understanding and analyzing data",
  "Social psychology is concerned with the understanding of human behaviour",
  "Optional tutorials are offered in the final week of a term",
  "We encourage students to complete their applications before the deadline",
  "There is a widely believed perception that engineering is for boys",
  "The rising inflation rate indicates a decrease in demand for consumer products",
  "All industries consist of systems of inputs processes outputs and feedback",
  "He wrote poetry and plays as well as scientific papers",
  "Many diseases that were once serious have now been eradicated."
];

const wfd = sentences.map((text, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: 'pred26-user-wfd-' + number,
    type: 'wfd',
    title: 'Prediction ' + number,
    minutes: 4,
    timeGroup: 'dictation',
    voice: ['nova', 'onyx', 'alloy', 'fable'][index % 4],
    text,
    narrationText: /[.!?]$/.test(text.trim()) ? text.trim() : text.trim() + '.',
    sample: text,
    audioMode: 'runtime-neural',
    ttsModel: 'tts-1-hd',
    audioSpeed: 0.95,
    predictionSource: {
      ...source,
      task: 'wfd',
      sourceId: 'user-wfd-' + number,
      sourceTitle: 'Prediction ' + number
    }
  };
});

module.exports = { source, sentences, wfd };
