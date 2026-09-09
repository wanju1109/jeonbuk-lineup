(function (root) {
  'use strict';
  function probability(prediction, option) {
    var dist = prediction && prediction.dist;
    if (!dist || typeof dist[option] !== 'number') return null;
    var values = Object.keys(dist).map(function (k) { return dist[k]; });
    if (values.some(function (v) { return typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1; })) return null;
    if (Math.abs(values.reduce(function (a, b) { return a + b; }, 0) - 1) > 0.002) return null;
    return dist[option];
  }
  function explanation(p) {
    if (!p || probability(p, p.pick) === null) return '모델 확률 정보가 없어 확률을 표시하지 않습니다.';
    var top = Object.keys(p.dist).reduce(function (a, b) { return p.dist[a] >= p.dist[b] ? a : b; });
    var text = '저장 픽 ' + p.pick + '의 모델 확률 ' + (100 * probability(p, p.pick)).toFixed(1) + '%.';
    if (p.dist[p.pick] < p.dist[top]) text += ' 모델 최다 확률은 ' + top + '입니다. 기존 판단으로 선택한 픽을 보존하며, 최다 확률을 이 픽의 확률로 표시하지 않습니다.';
    return text;
  }
  var api = { probability: probability, explanation: explanation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PredictionDisplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
