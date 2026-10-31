'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),policy=require('../account-security');
test('Auth input bounds reject malformed types without rejecting existing short-password logins',()=>{
 for(const user of [null,[],{},'','x'.repeat(101),'a|b','a\nb'])assert(policy.credentialsError(user,'Password123'));
 for(const password of [null,{},[],'x'.repeat(1025)])assert(policy.credentialsError('alice',password));
 assert.equal(policy.credentialsError('alice','old'),null);
 for(const email of ['',null,'notmail','x'.repeat(255)+'@example.test','a@ptewriting.com'])assert(policy.credentialsError('alice','Password123',{register:true,email}));
 assert.equal(policy.credentialsError('alice','Password123',{register:true,email:'a@example.test'}),null);
});
test('Reset links use the portal origin and reject attacker-controlled host headers',()=>{
 const req={get:()=> 'evil.example'};assert.equal(policy.resetOrigin(req,{NODE_ENV:'production'}),'https://swt.up.railway.app');
 assert.equal(policy.resetOrigin(req,{PORTAL_PUBLIC_URL:'https://swt.up.railway.app/path'}),'https://swt.up.railway.app');
 assert.equal(policy.resetOrigin(req,{PORTAL_PUBLIC_URL:'https://user:password@evil.test'}),'https://swt.up.railway.app');
 assert.equal(policy.resetOrigin({get:()=> '127.0.0.1:1234'},{NODE_ENV:'test'}),'http://127.0.0.1:1234');
});
test('Malformed signed tokens, extra components and oversized payloads are rejected before comparison',()=>{
 for(const token of [null,{},'a.'+'é'.repeat(64),'a.'+'0'.repeat(64)+'.extra','x'.repeat(4097)])assert.equal(policy.signedParts(token),null);
 assert.equal(policy.signatureMatches('é'.repeat(64),'a'.repeat(64)),false);assert(policy.signatureMatches('a'.repeat(64),'a'.repeat(64)));
});
