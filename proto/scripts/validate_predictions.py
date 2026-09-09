"""Offline chronological evaluation. Run from any directory; no network required."""
import copy
import hashlib
import json
import math
from pathlib import Path

from update_results import poisson_preview, prior_finished, key_team

DATA = Path(__file__).resolve().parents[1] / 'data'
LABELS = ('승', '무', '패')


def forecast(rows, match, shrink):
    if shrink is None:
        return poisson_preview(rows, match['league'], match['home'], match['away'], match['date'])['picks']['wdl']['dist']
    prior = prior_finished(rows, match['league'], match['date'])
    # League priors prevent zero-goal/small-sample extremes at season start.
    hg = (sum(m['score'][0] for m in prior) + 12 * 1.2) / (len(prior) + 12)
    ag = (sum(m['score'][1] for m in prior) + 12) / (len(prior) + 12)
    def rates(team, side):
        games = [m for m in prior if key_team(m['home' if side == 0 else 'away']) == key_team(team)]
        gf = sum(m['score'][side] for m in games)
        ga = sum(m['score'][1-side] for m in games)
        return ((gf + shrink * (hg if side == 0 else ag)) / (len(games)+shrink),
                (ga + shrink * (ag if side == 0 else hg)) / (len(games)+shrink))
    ha, hd = rates(match['home'], 0)
    aa, ad = rates(match['away'], 1)
    # Opponent away concession is measured against league HOME goals, and vice versa.
    xh = min(4, max(.25, (ha * ad / hg + hg) / 2))
    xa = min(4, max(.25, (aa * hd / ag + ag) / 2))
    dist = dict.fromkeys(LABELS, 0.)
    for h in range(21):
        for a in range(21):
            p = math.exp(-xh-xa)*xh**h*xa**a/math.factorial(h)/math.factorial(a)
            dist['승' if h > a else '패' if h < a else '무'] += p
    total = sum(dist.values())
    return {k: v/total for k, v in dist.items()}


def metrics(pairs):
    n = len(pairs)
    hits = sum(max(p, key=p.get) == y for p, y in pairs)
    return dict(n=n, hits=hits, accuracy=round(hits/n, 6),
                log_loss=round(-sum(math.log(max(p[y], 1e-12)) for p,y in pairs)/n, 6),
                brier=round(sum(sum((p[k]-(k==y))**2 for k in LABELS) for p,y in pairs)/n, 6))


def main():
    raw = (DATA/'league.json').read_bytes()
    data = json.loads(raw)
    rows = sorted([m for m in data['matches'] if m.get('finished') and isinstance(m.get('score'), list)
                   and len(m['score']) == 2 and m.get('date')], key=lambda m:(m['date'],m['id']))
    dates = sorted({m['date'] for m in rows})
    cutoff = dates[int(len(dates)*.7)]
    candidates = {'legacy_poisson': None, 'shrink4': 4, 'shrink8': 8, 'shrink16': 16}
    predictions = {name: [forecast(rows,m,s) for m in rows] for name,s in candidates.items()}
    actual = ['승' if m['score'][0]>m['score'][1] else '패' if m['score'][0]<m['score'][1] else '무' for m in rows]
    results = {}
    for name, preds in predictions.items():
        results[name] = {split: metrics([(p,y) for m,p,y in zip(rows,preds,actual)
                                       if (m['date']<cutoff)==(split=='development')])
                         for split in ('development','holdout')}
    selected = min(candidates, key=lambda k: results[k]['development']['log_loss'])
    old, new = results['legacy_poisson']['holdout'], results[selected]['holdout']
    accepted = selected != 'legacy_poisson' and new['accuracy'] > old['accuracy'] and new['log_loss'] < old['log_loss'] and new['brier'] < old['brier']
    stored_hits = sum(m['picks']['wdl']['pick']==y for m,y in zip(rows,actual))
    mismatch = sum(abs(m['picks']['wdl'].get('prob',0)-m['picks']['wdl']['dist'].get(m['picks']['wdl']['pick'],0))>.001 for m in rows)
    nonmax = sum(m['picks']['wdl']['pick'] != max(m['picks']['wdl']['dist'], key=m['picks']['wdl']['dist'].get) for m in rows)
    report = dict(source_sha256=hashlib.sha256(raw).hexdigest(), cutoff=cutoff, first_date=dates[0], last_date=dates[-1],
                  protocol='First 70% of distinct dates select lowest development log loss. Remaining dates used once for acceptance. Every forecast uses strictly earlier dates only. No odds used: pre-kickoff timestamps unavailable. Retrospective replay, not prospective performance.',
                  candidates=results, selected=selected, accepted=accepted,
                  stored_pick_audit=dict(n=len(rows), hits=stored_hits, probability_mismatches=mismatch, non_argmax_picks=nonmax),
                  home_only_holdout=metrics([({'승':1.,'무':0.,'패':0.},y) for m,y in zip(rows,actual) if m['date']>=cutoff]),
                  replay=[dict(id=m['id'], date=m['date'], actual=y, probabilities={k:v[i] for k,v in predictions.items()}) for i,(m,y) in enumerate(zip(rows,actual))])
    (DATA/'prediction_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='replay'},ensure_ascii=True,indent=2))


if __name__ == '__main__':
    main()
