'use strict';
const provider = require('./mock-content-provider');

function createMockContentAssessment(options={}) {
  const transport = provider.createProvider(options);
  const speakingFormat = require('./speaking-judge-format');
  const swtFormat = require('./swt-judge-format');
  const swtPolicy = require('./swt-scoring-policy');
  const swtService = require('./swt-judgment-service').createJudgmentService({
    policyVersion:swtPolicy.POLICY_VERSION+':'+provider.MODEL,
    buildPrompt:swtPolicy.buildJudgingPrompt,
    totalTimeoutMs:180000,
    call:async (prompt,timeoutMs,{signal,semanticReassessment}={}) => ({...swtFormat.response(await transport.call(
      swtFormat.request(prompt,provider.MODEL,{semanticReassessment}), {timeoutMs,signal,task:'swt'})),source:'openai'}),
    isComplete:(result,summary,passage) => !swtPolicy.applyScoringPolicy(result,summary,passage).needs_semantic_review,
    validationIssues:(result,summary,passage) => swtPolicy.applyScoringPolicy(result,summary,passage).assessment_issues,
    onAttemptError:options.onAttemptError
  });
  const essayEnv = { ...process.env, ...options.env, ESSAY_SCORING_PROVIDER:'openai', ESSAY_OPENAI_MODEL:provider.MODEL,
    ESSAY_OPENAI_REASONING_EFFORT:provider.REASONING_EFFORT };
  const essayProvider = require('./essay-provider').createEssayProvider({ apiKey:options.apiKey, fetch:options.fetch, env:essayEnv });
  const essay = require('./essay-grading').createEssayGrader(essayProvider, {
    onAttemptError:options.onAttemptError,
    onAssessment:details => options.onAssessment?.({ ...details, task:'essay', provider:'openai', model:provider.MODEL })
  });
  return {
    configuration:transport.configuration,
    essay,
    async speaking(prompt,context={}) {
      const raw = await transport.call(speakingFormat.request(prompt,provider.MODEL,context),
        { timeoutMs:context.wholeMockEntries ? 120000 : 90000, task:context.question?.type || 'speaking-overall' });
      return speakingFormat.response(raw,context);
    },
    swt:(question,text) => swtService.judge(text,question.text,'',60000),
    async writing(prompt) {
      const raw = await transport.call({ max_tokens:3000, messages:[{role:'user',content:prompt}] },{task:'sst'});
      return JSON.parse(raw.content[0].text);
    },
    async overall(attempt) {
      const format = require('./writing-mock-overall');
      return format.response(await transport.call(format.request(attempt,provider.MODEL),{timeoutMs:120000,task:'writing-overall'}));
    }
  };
}
module.exports = { createMockContentAssessment };
