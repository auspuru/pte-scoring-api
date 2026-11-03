'use strict';
const test=require('node:test'),{fixture}=require('./helpers/auth-server'),{duplicateAccounts}=require('./helpers/duplicate-accounts-cases');
test('New registrations reject reused emails, concurrent duplicates and ambiguous legacy recovery',{timeout:30000},async t=>duplicateAccounts(t,await fixture(t)));
