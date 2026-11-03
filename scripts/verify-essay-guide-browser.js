'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {releaseEnvironment}=require('./verify-release');
// Fail early on the changed UI flow; the complete release suite still runs next.
const auth=spawnSync(process.execPath,['--test','--test-name-pattern=SWT practice submits with the signed-in session|Staff releases the final failed Repeat Sentence','tests/auth-browser.system.js'],{
 cwd:path.resolve(__dirname,'..'),env:releaseEnvironment(process.env),stdio:'inherit'
});
if(auth.error)throw Error('SWT authenticated browser verification could not start.');
if(auth.status!==0)process.exitCode=Number.isInteger(auth.status)?auth.status:1;
else {
const result=spawnSync(process.execPath,['--test','--test-name-pattern=Essay guide:|SWT review:|SWT mock feedback:|Reading mock history:','tests/practice-navigation-browser.system.js'],{
 cwd:path.resolve(__dirname,'..'),env:releaseEnvironment(process.env),stdio:'inherit'
});
if(result.error)throw Error('Practice feedback browser verification could not start.');
process.exitCode=Number.isInteger(result.status)?result.status:1;
}
