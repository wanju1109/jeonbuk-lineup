'use strict';
const status=document.querySelector('#status');
const url=new URL('./',location.href);
url.search='';url.hash='';
document.querySelector('#share-url').value=url.href;
document.querySelector('#preview').href=url.href;
document.querySelector('#embed-code').value=`<iframe src="${url.href}" title="나는 누구일까요? K리그 선수 퀴즈" width="100%" height="720" style="border:0;border-radius:16px;height:min(720px,100dvh)" loading="lazy" allow="clipboard-write"></iframe>`;
async function copyField(id,message){const input=document.getElementById(id);try{await navigator.clipboard.writeText(input.value);status.textContent=message;}catch{input.focus();input.select();status.textContent='자동 복사를 사용할 수 없어 내용을 선택했습니다. 직접 복사해 주세요.';}}
document.querySelector('#copy').onclick=()=>copyField('share-url','바로 시작하는 게임의 링크를 복사했습니다.');
document.querySelector('#copy-embed').onclick=()=>copyField('embed-code','바로 시작하는 게임의 iframe 코드를 복사했습니다.');
