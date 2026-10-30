const {test} = require('node:test');
const assert = require('node:assert/strict');
const {securityHeaders} = require('../middleware/securityHeaders');
function headers(path,method='GET') { const h={};securityHeaders({path,method},{setHeader:(k,v)=>{h[k]=v}},()=>{});return h; }
test('встраивать разрешено только публичную страницу с валидным ID',()=>{
 const h=headers('/booking/01234567-89ab-4cde-8123-0123456789ab');
 assert.equal(h['X-Frame-Options'],undefined);assert.match(h['Content-Security-Policy'],/frame-ancestors \*/);
 for(const path of ['/admin','/visitor','/booking/invalid','/api/booking/public/01234567-89ab-4cde-8123-0123456789ab']) {const x=headers(path);assert.equal(x['X-Frame-Options'],'SAMEORIGIN');assert.match(x['Content-Security-Policy'],/frame-ancestors 'self'/);}
 assert.equal(headers('/booking/01234567-89ab-4cde-8123-0123456789ab','POST')['X-Frame-Options'],'SAMEORIGIN');
});
