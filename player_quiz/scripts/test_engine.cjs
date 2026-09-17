const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Quiz=require('../engine.js');
const root=path.resolve(__dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8')).version;
const data=JSON.parse(fs.readFileSync(path.join(root,`data/${version}.json`),'utf8'));
const base={v:1,data:version,scope:'jb',level:'normal',count:10,seed:42};
assert.deepEqual(Quiz.decode(Quiz.encode(base)),base);
for(const bad of [null,{...base,scope:'__proto__'},{...base,count:100},{...base,seed:NaN},{...base,data:'../../private'}])assert.throws(()=>Quiz.validate(bad));
assert.throws(()=>Quiz.decode('not-json'));
assert.equal(Quiz.points(0,true),100);assert.equal(Quiz.points(2,true),50);assert.equal(Quiz.points(20,true),25);assert.equal(Quiz.points(0,false),0);
for(const scope of Object.keys(Quiz.scopes))for(const level of Object.keys(Quiz.levels))for(let seed=0;seed<40;seed++){
 const c={...base,scope,level,seed,count:20},qs=Quiz.questions(data,c);
 assert.equal(qs.length,20);assert.equal(new Set(qs.map(q=>q.answer.id)).size,20);
 assert.deepEqual(qs,Quiz.questions(data,c));
 const pool=new Set(Quiz.pool(data,scope).map(p=>p.id));
 for(const q of qs){assert.equal(q.options.length,4);assert.equal(new Set(q.options.map(p=>p.name)).size,4);assert(q.options.every(p=>pool.has(p.id)));assert(q.options.some(p=>p.id===q.answer.id));assert(q.hints.length>=5);}
}
assert(Quiz.pool(data,'jb').every(p=>p.team==='K05'&&p.current));
assert(Quiz.pool(data,'k1').every(p=>p.league==='1'&&p.current));
assert(Quiz.pool(data,'history').some(p=>p.name==='이동국'));
assert(Quiz.pool(data,'history').some(p=>p.name==='조규성'));
console.log('PASS: 480 seeded games / 9,600 questions, scopes, serialization, scoring, malformed links, historical players');

for(const [level,base] of [['easy',100],['normal',150],['hard',200]]){assert.equal(Quiz.points(0,true,level),base);assert.equal(Quiz.points(1,true,level),base-25);assert.equal(Quiz.points(100,true,level),25);assert.equal(Quiz.points(0,false,level),0);for(const n of [5,10,20])assert.equal(n*Quiz.points(0,true,level),n*base);}
assert.equal(Quiz.points(4,true,'hard'),Quiz.points(0,true,'easy'));
assert.equal(Quiz.points(2,true,'normal'),Quiz.points(0,true,'easy'));
assert.equal(Quiz.nickname('  전주월드컵경기장  '),'전주월드컵경기장');
for(const bad of ['', ' ', 'a', 'a'.repeat(21), '<script>', '닉네임\n위조', '이름\u202e'])assert.throws(()=>Quiz.nickname(bad));
assert.throws(()=>Quiz.points(-1,true,'hard'));assert.throws(()=>Quiz.points(0,true,'__proto__'));
