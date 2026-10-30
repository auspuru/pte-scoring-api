'use strict';
const {hash}=require('./scoring-jobs');
const ENGINES={speaking:'Speaking',writing:'Writing',listening:'Listening',reading:'Reading',full:'Full'};
const KINDS={submitted:'submitted',error:'error',attention:'needs attention'};
const clean=(value,max=140)=>String(value??'').replace(/[\x00-\x1f\x7f<>]/g,' ').slice(0,max);
function eventKey(event){
  if(!ENGINES[event?.engine]||!KINDS[event?.kind]||typeof event.username!=='string'||!event.username.trim()||event.username.length>120
    ||typeof event.attemptId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(event.attemptId))throw Error('Invalid mock alert identity.');
  // One submission, one error and one attention notice per owning mock attempt.
  return hash({version:'mock-admin-event-v1',engine:event.engine,kind:event.kind,username:event.username,attemptId:event.attemptId});
}
function messageFor(event,{recipient,from,origin}){
  const key=eventKey(event),label=ENGINES[event.engine],kind=KINDS[event.kind];
  const time=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'}).format(new Date(event.at));
  const lines=[label+' mock '+kind+'.','',
    'Student username: '+clean(event.username),'Mock: '+clean(event.title||label+' mock'),'Attempt ID: '+event.attemptId,
    'Time: '+time+' (Brisbane)',
    ...(event.kind==='submitted'?['Submission received and saved.','Report status: '+(event.ready?'Ready':'Preparing results')]:[
      'Issue: '+clean(event.code||'ASSESSMENT_PENDING'),
      'Stage: '+clean(event.operation||'assessment'),
      ...(Number.isInteger(event.pending)?['Pending question assessments: '+event.pending]:[]),
      event.kind==='attention'?'The report needs checking. Retain saved answers and completed assessments.':'Check the affected saved action and service diagnostics before retrying.'
    ]),
    '', 'Admin portal: '+origin+'/admin',
    'Attempt status (admin authentication required): '+origin+'/api/admin/mock-alerts/'+event.engine+'/'+encodeURIComponent(event.username)+'/'+encodeURIComponent(event.attemptId),
    '', 'This email contains no student answers, transcripts or recordings.',
    'Repeated requests and service restarts do not send another '+kind+' notice for this attempt.'];
  return{from:'"IPT Brisbane Alerts" <'+from+'>',to:recipient,replyTo:from,
    subject:'[IPT Brisbane] '+label+' mock '+kind+': '+clean(event.username,80),
    messageId:'<mock-event-'+key.slice(0,40)+'@'+new URL(origin).hostname+'>',text:lines.join('\n')};
}
module.exports={ENGINES,KINDS,eventKey,messageFor};
