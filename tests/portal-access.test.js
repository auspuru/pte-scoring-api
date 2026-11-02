'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),access=require('../portal-access');
test('Portal dates include the entire final Brisbane day, independent of the host timezone',()=>{
 const account=access.validate('2026-11-02','2026-11-03');
 assert.equal(access.state(account,Date.parse('2026-11-01T13:59:59.999Z')).status,'scheduled');
 assert.equal(access.state(account,Date.parse('2026-11-01T14:00:00Z')).status,'active');
 assert.equal(access.state(account,Date.parse('2026-11-03T13:59:59.999Z')).status,'active');
 assert.equal(access.state(account,Date.parse('2026-11-03T14:00:00Z')).status,'expired');
 assert.equal(access.denial(account,Date.parse('2026-11-03T14:00:00Z')).code,'PORTAL_ACCESS_EXPIRED');
 assert.equal(access.denial(account,Date.parse('2026-11-02T00:00:00Z')),null);
});
test('Optional dates preserve indefinite access; invalid and reversed dates fail',()=>{
 assert.deepEqual(access.validate('',null),{accessStartsOn:null,accessExpiresOn:null});
 assert.equal(access.state({}).status,'active');
 assert.equal(access.validate('2028-02-29','2028-02-29').accessExpiresOn,'2028-02-29');
 for(const bad of ['2026-02-29','2026-04-31','02/11/2026','2026-11-02T00:00Z','2026-2-01','1899-12-31',true,{},undefined])assert.throws(()=>access.validate(null,bad));
 assert.throws(()=>access.validate('2026-11-03','2026-11-02'),/on or after/);
});
