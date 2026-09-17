(function(root){
'use strict';
const scopes={jb:'전북 현대 · 현재',history:'전북 현대 · 역대',k1:'K리그1 · 현재',all:'K리그1 + K리그2 · 현재'};
const levels={easy:{name:'하',hints:5,points:100},normal:{name:'중',hints:3,points:150},hard:{name:'상',hints:1,points:200}};
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,r){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function pool(data,scope){return data.players.filter(p=>scope==='jb'?p.current&&p.team==='K05':scope==='history'?p.jeonbuk:scope==='k1'?p.current&&p.league==='1':scope==='all'?p.current:false);}
function validate(c){if(!c||c.v!==1||!Object.hasOwn(scopes,c.scope)||!Object.hasOwn(levels,c.level)||![5,10,20].includes(c.count)||!Number.isInteger(c.seed)||c.seed<0||c.seed>4294967295||!/^[a-f0-9]{16}$/.test(c.data))throw Error('공유 링크가 올바르지 않습니다. 출제자에게 새 링크를 요청해 주세요.');return c;}
function encode(c){validate(c);return btoa(JSON.stringify(c)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function decode(s){if(!s||s.length>600)throw Error('공유 링크가 올바르지 않습니다.');try{return validate(JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/'))));}catch(e){throw Error('공유 링크가 올바르지 않습니다. 출제자에게 새 링크를 요청해 주세요.');}}
function questions(data,c,quick=false){validate(c);const candidates=pool(data,c.scope),r=rng(c.seed);if(candidates.length<c.count||candidates.length<4)throw Error('이 범위에 출제할 선수가 부족합니다.');let selected=shuffle(candidates,r).slice(0,c.count);if(quick&&c.scope==='jb'&&c.level==='easy'){const appearances=p=>parseInt(p.hints.find(h=>h[0]==='전북 K리그1 통산 출장')?.[1],10)||0;const familiar=[...candidates].sort((a,b)=>appearances(b)-appearances(a)).slice(0,8);const opener=shuffle(familiar,r)[0];selected=[opener,...shuffle(candidates.filter(p=>p.id!==opener.id),r).slice(0,c.count-1)];}return selected.map(answer=>{
 const others=shuffle(candidates.filter(p=>p.id!==answer.id&&p.name!==answer.name),r);
 const same=others.filter(p=>p.position===answer.position),different=others.filter(p=>p.position!==answer.position);
 const distractors=[],names=new Set();for(const p of [...same,...different]){if(names.has(p.name))continue;names.add(p.name);distractors.push(p);if(distractors.length===3)break;}
 if(distractors.length<3)throw Error('서로 다른 보기 4개를 만들 수 없습니다.');
 // At least one visible distinguishing hint; avoid an impossible opening question.
 const options=shuffle([answer,...distractors],r);let hints=shuffle(answer.hints,r);
 const unique=hints.findIndex(([label,value])=>distractors.every(p=>!p.hints.some(h=>h[0]===label&&h[1]===value)));
 if(unique>=0){const [h]=hints.splice(unique,1);hints.unshift(h);}
 else hints.unshift(['이름 초성',initials(answer.name)]);
 if(data.hintPolicy>=2){
  const category=h=>h[2]||(/팀|시즌|통산/.test(h[0])?'career':'profile');
  const distinguishes=h=>distractors.every(p=>!p.hints.some(x=>x[0]===h[0]&&x[1]===h[1]));
  const highlight=data.hintPolicy>=4?hints.findIndex(h=>category(h)==='highlight'&&(!['jb','history'].includes(c.scope)||h[0].includes('전북'))&&distinguishes(h)):-1;
  const jbFirst=data.hintPolicy>=3&&['jb','history'].includes(c.scope)?hints.findIndex(h=>h[0].includes('전북')&&distinguishes(h)):-1;
  const preferred=highlight>=0?highlight:jbFirst>=0?jbFirst:hints.findIndex(h=>category(h)==='season'&&distinguishes(h));
  const record=preferred>=0?preferred:hints.findIndex(h=>category(h)==='career'&&distinguishes(h));
  if(record>=0){const [h]=hints.splice(record,1);hints.unshift(h);}
  const mixed=[hints.shift()];
  while(hints.length){const next=hints.findIndex(h=>category(h)!==category(mixed[mixed.length-1]));mixed.push(hints.splice(next<0?0:next,1)[0]);}
  hints=mixed;
 }
 return {answer,options,hints};
});}
function initials(s){return [...s].map(c=>{const n=c.charCodeAt(0)-44032;return n>=0&&n<11172?'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(n/588)]:c;}).join('');}
function points(extra,correct,level='easy'){if(!Object.hasOwn(levels,level)||!Number.isInteger(extra)||extra<0)throw Error('잘못된 배점 조건');return correct?Math.max(25,levels[level].points-25*extra):0;}
function score100(raw,count,level){if(!Object.hasOwn(levels,level)||![5,10,20].includes(count)||!Number.isFinite(raw)||raw<0||raw>count*levels[level].points)throw Error('잘못된 점수');return Math.round(raw/(count*levels[level].points)*1000)/10;}
function nickname(value){const name=String(value??'').normalize('NFC').trim();if(!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 _-]{2,20}$/.test(name))throw Error('닉네임은 한글·영문·숫자·공백·밑줄·하이픈으로 2~20자 입력해 주세요.');return name;}
const api={scopes,levels,pool,validate,encode,decode,questions,points,nickname,score100};
if(typeof module!=='undefined')module.exports=api;else root.Quiz=api;
})(globalThis);
