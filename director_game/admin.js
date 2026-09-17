'use strict';
const url=new URL('./',location.href);url.search='';url.hash='';
document.querySelector('#share-url').value=url.href;document.querySelector('#preview').href=url.href;
document.querySelector('#embed-code').value=`<iframe src="${url.href}" title="전북 단장 · 딱 한 명만" width="100%" height="800" style="border:0;border-radius:16px" loading="lazy" allow="clipboard-write"></iframe>`;
async function copy(id){const input=document.getElementById(id);try{await navigator.clipboard.writeText(input.value);document.querySelector('#status').textContent='복사했습니다.';}catch{input.focus();input.select();document.querySelector('#status').textContent='자동 복사가 차단되었습니다. 선택된 내용을 직접 복사해 주세요.';}}
document.querySelector('#copy-link').onclick=()=>copy('share-url');document.querySelector('#copy-embed').onclick=()=>copy('embed-code');
