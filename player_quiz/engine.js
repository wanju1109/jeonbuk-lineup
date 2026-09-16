(function(root){
'use strict';
const scopes={jb:'전북 현대 · 현재',history:'전북 현대 · 역대',k1:'K리그1 · 현재',all:'K리그1 + K리그2 · 현재'};
const levels={easy:{name:'하',hints:5},normal:{name:'중',hints:3},hard:{name:'상',hints:1}};
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,r){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function pool(data,scope){return data.players.filter(p=>scope==='jb'?p.current&&p.team==='K05':scope==='history'?p.jeonbuk:scope==='k1'?p.current&&p.league==='1':scope==='all'?p.current:false);}
function validate(c){if(!c||c.v!==1||!Object.hasOwn(scopes,c.scope)||!Object.hasOwn(levels,c.level)||![5,10,20].includes(c.count)||!Number.isInteger(c.seed)||c.seed<0||c.seed>4294967295||!/^[a-f0-9]{16}$/.test(c.data))throw Error('공유 링크가 올바르지 않습니다. 출제자에게 새 링크를 요청해 주세요.');return c;}
function encode(c){validate(c);return btoa(JSON.stringify(c)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function decode(s){if(!s||s.length>600)throw Error('공유 링크가 올바르지 않습니다.');try{return validate(JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/'))));}catch(e){throw Error('공유 링크가 올바르지 않습니다. 출제자에게 새 링크를 요청해 주세요.');}}
function questions(data,c){validate(c);const candidates=pool(data,c.scope),r=rng(c.seed);if(candidates.length<c.count||candidates.length<4)throw Error('이 범위에 출제할 선수가 부족합니다.');return shuffle(candidates,r).slice(0,c.count).map(answer=>{
 const others=shuffle(candidates.filter(p=>p.id!==answer.id&&p.name!==answer.name),r);
 const same=others.filter(p=>p.position===answer.position),different=others.filter(p=>p.position!==answer.position);
 const distractors=[],names=new Set();for(const p of [...same,...different]){if(names.has(p.name))continue;names.add(p.name);distractors.push(p);if(distractors.length===3)break;}
 if(distractors.length<3)throw Error('서로 다른 보기 4개를 만들 수 없습니다.');
 // At least one visible distinguishing hint; avoid an impossible opening question.
 const options=shuffle([answer,...distractors],r);let hints=shuffle(answer.hints,r);
 const unique=hints.findIndex(([label,value])=>distractors.every(p=>!p.hints.some(h=>h[0]===label&&h[1]===value)));
 if(unique>=0){const [h]=hints.splice(unique,1);hints.unshift(h);}
 else hints.unshift(['이름 초성',initials(answer.name)]);
 return {answer,options,hints};
});}
function initials(s){return [...s].map(c=>{const n=c.charCodeAt(0)-44032;return n>=0&&n<11172?'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(n/588)]:c;}).join('');}
function points(extra,correct){return correct?Math.max(20,100-20*extra):0;}
const api={scopes,levels,pool,validate,encode,decode,questions,points};
if(typeof module!=='undefined')module.exports=api;else root.Quiz=api;
})(globalThis);
