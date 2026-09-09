const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const display = require('../prediction-display.js');
const p = {pick:'무', prob:.6, dist:{'승':.6,'무':.25,'패':.15}};
assert.equal(display.probability(p,'무'), .25);
assert.match(display.explanation(p), /25.0%/);
assert.match(display.explanation(p), /최다 확률은 승/);
assert.equal(display.probability({dist:{'승':NaN}},'승'), null);
assert.equal(display.probability({dist:{'승':1.5}},'승'), null);
assert.equal(display.probability({dist:{'승':.2}},'승'), null);
const root = path.resolve(__dirname,'..');
const data = JSON.parse(fs.readFileSync(path.join(root,'data/league.json'),'utf8'));
const before = JSON.stringify(data.matches.map(m=>m.picks));
const elements = {};
function element(id) {
  return elements[id] ||= {innerHTML:'',textContent:'',style:{},addEventListener(){},classList:{toggle(){}}};
}
const context = {
  PredictionDisplay:display, console, Date, localStorage:{getItem:()=> '{}'},
  document:{querySelector:element,getElementById:element,querySelectorAll:()=>[]},
  fetch: async url => {
    if (url.startsWith('data/league.json')) return {ok:true,json:async()=>data};
    throw new Error('offline odds');
  }
};
const html = fs.readFileSync(path.join(root,'view.html'),'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(script,context);
setImmediate(()=>{
  assert.match(elements.stats.innerHTML,/저장 픽 승무패/);
  assert.match(elements.list.innerHTML,/article/);
  assert.equal(JSON.stringify(data.matches.map(m=>m.picks)),before);
  assert.ok(!script.includes('setPick('));
  console.log('Display probabilities, page initialization, offline odds, saved-pick preservation: PASS');
});
