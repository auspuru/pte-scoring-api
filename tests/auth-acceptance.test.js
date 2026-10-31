'use strict';
const test=require('node:test'),{fixture}=require('./helpers/auth-server'),{acceptance}=require('./helpers/auth-acceptance-cases');
test('AUTH-02/05/06/07/08: disposable real-server account and recovery acceptance',{timeout:30000},async t=>acceptance(t,await fixture(t)));
