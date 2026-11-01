'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {releaseEnvironment}=require('./verify-release');
// Fail early on the changed UI flow; the complete release suite still runs next.
const result=spawnSync(process.execPath,['--test','--test-name-pattern=Essay guide:','tests/practice-navigation-browser.system.js'],{
 cwd:path.resolve(__dirname,'..'),env:releaseEnvironment(process.env),stdio:'inherit'
});
if(result.error)throw Error('Essay guide browser verification could not start.');
process.exitCode=Number.isInteger(result.status)?result.status:1;
