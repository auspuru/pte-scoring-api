'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {releaseEnvironment}=require('./verify-release');
// Fail early on the changed UI flow; the complete release suite still runs next.
const auth=spawnSync(process.execPath,['--test','--test-name-pattern=Staff username and password sign-in|AUTH-01/03/04|SWT practice submits with the signed-in session|Staff releases the final failed Repeat Sentence|Staff releases the final unreached Speaking question|Staff analyses missing mock results|Staff reviews Azure replacement|User detail opens|Staff publishes confirmed timed-out','tests/auth-browser.system.js'],{
 cwd:path.resolve(__dirname,'..'),env:releaseEnvironment(process.env),stdio:'inherit'
});
if(auth.error)throw Error('SWT authenticated browser verification could not start.');
if(auth.status!==0)process.exitCode=Number.isInteger(auth.status)?auth.status:1;
else {
const result=spawnSync(process.execPath,['--test','--test-name-pattern=Listening workspace:.*1366px|Speaking practice |Unified practice library:|Reading workspace:|Writing workspace:|Essay guide:|SWT review:|SWT mock feedback:|Reading mock history:|Practice storage:|Progress opens exact saved responses|UX libraries:|UX audio review|UX history keeps','tests/practice-navigation-browser.system.js','tests/practice-library-browser.system.js','tests/speaking-practice-browser.system.js','tests/portal-ux-browser.system.js'],{
 cwd:path.resolve(__dirname,'..'),env:releaseEnvironment(process.env),stdio:'inherit'
});
if(result.error)throw Error('Practice feedback browser verification could not start.');
process.exitCode=Number.isInteger(result.status)?result.status:1;
}
