"""2023-24 fit, 2025 selection, 2026 rolling-feature evaluation. No random split."""
import hashlib
import json
import math
from pathlib import Path

from prediction_model import LABELS, FEATURES, VERSION, replay_features, fit, predict
from update_results import key_team, poisson_preview

DATA = Path(__file__).resolve().parents[1] / 'data'
# Fixed small candidate set; 2026 is never used to choose a candidate or penalty.
CANDIDATES = {'poisson':None, 'elo':None, 'logistic_ridge02':.02,
              'logistic_ridge10':.1, 'ensemble':.02}


def metrics(pairs):
    n=len(pairs)
    if not n: return dict(n=0,hits=0,accuracy=None,log_loss=None,brier=None)
    hits=sum(max(range(3),key=lambda i:p[i])==y for p,y in pairs)
    rate=hits/n; z=1.96; denom=1+z*z/n
    center=(rate+z*z/(2*n))/denom
    half=z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/denom
    return dict(n=n,hits=hits,accuracy=round(rate,6),
                interval95=[round(center-half,4),round(center+half,4)],
                log_loss=round(-sum(math.log(max(p[y],1e-12)) for p,y in pairs)/n,6),
                brier=round(sum(sum((v-(i==y))**2 for i,v in enumerate(p)) for p,y in pairs)/n,6))


def evaluate(examples, name, weights):
    return [(predict(e,name,weights),e['y']) for e in examples]


def main():
    raw=(DATA/'official_history.json').read_bytes()
    history=json.loads(raw)
    rows=history['matches']
    examples=replay_features(rows)
    train=[e for e in examples if e['match']['season']<2025]
    select=[e for e in examples if e['match']['season']==2025]
    test=[e for e in examples if e['match']['season']==2026]
    learned={penalty:fit(train,penalty) for penalty in (.02,.1)}
    selection={name:metrics(evaluate(select,name,learned.get(penalty))) for name,penalty in CANDIDATES.items()}
    winner=min(selection,key=lambda name:selection[name]['log_loss'])
    # Refit the selected family after selection. Still no 2026 labels used for coefficients.
    weights=fit(train+select,CANDIDATES[winner]) if CANDIDATES[winner] is not None else None
    pairs=evaluate(test,winner,weights)
    model=metrics(pairs)
    current_rows=[m for m in rows if m['season']==2026]
    legacy=[]
    for e in test:
        m=e['match']
        dist=poisson_preview(current_rows,m['league'],m['home'],m['away'],m['date'])['picks']['wdl']['dist']
        legacy.append(([dist[k] for k in LABELS],e['y']))
    baseline=metrics(legacy)
    league=json.loads((DATA/'league.json').read_text(encoding='utf-8'))
    stored={(m['league'],m['date'],key_team(m['home']),key_team(m['away'])):m for m in league['matches']}
    audit=[]
    for e in test:
        m=e['match']; old=stored.get((m['league'],m['date'],key_team(m['home']),key_team(m['away'])))
        if old: audit.append(dict(id=old['id'],hit=old['picks']['wdl']['pick']==LABELS[e['y']],score_conflict=old['score']!=m['score']))
    accepted=model['accuracy']>baseline['accuracy'] and model['log_loss']<baseline['log_loss'] and model['brier']<baseline['brier']
    buckets=[]
    for low, high in ((0,.4),(.4,.5),(.5,.6),(.6,1.000001)):
        subset=[(p,y) for p,y in pairs if low<=max(p)<high]
        buckets.append(dict(lower=low,upper=min(1,high),mean_probability=round(sum(max(p) for p,y in subset)/len(subset),4) if subset else None,**metrics(subset)))
    thresholds=[]
    # Diagnostic coverage, not a tuned betting rule; low-confidence matches are never hidden.
    for threshold in (.45,.5,.55,.6):
        subset=[(p,y) for p,y in pairs if max(p)>=threshold]
        thresholds.append(dict(threshold=threshold,coverage=round(len(subset)/len(pairs),4),**metrics(subset)))
    report=dict(version=VERSION,source_sha256=hashlib.sha256(raw).hexdigest(),last_date=max(m['date'] for m in rows),
        protocol=dict(fit='2023-2024',selection='2025: minimum log loss',evaluation='2026: coefficients frozen; features updated after each date',
                      caveat='Retrospective comparison. Earlier work inspected 2026; no claim of pristine independent holdout. Post-2026-09-08 subset reported separately. Future predictions are timestamped.'),
        train_n=len(train),selection_n=len(select),selected=winner,accepted=accepted,deployment='shadow',selection=selection,
        evaluation=model,legacy=baseline,stored=dict(n=len(audit),hits=sum(a['hit'] for a in audit),accuracy=round(sum(a['hit'] for a in audit)/len(audit),6),score_conflicts=sum(a['score_conflict'] for a in audit)),
        by_league={lg:metrics([pair for e,pair in zip(test,pairs) if e['match']['league']==lg]) for lg in ('K1','K2')},
        recent=metrics([pair for e,pair in zip(test,pairs) if e['match']['date']>'2026-09-08']),
        recent_legacy=metrics([pair for e,pair in zip(test,legacy) if e['match']['date']>'2026-09-08']),
        calibration=buckets,thresholds=thresholds,
        replay=[dict(id=e['match']['id'],date=e['match']['date'],league=e['match']['league'],actual=LABELS[y],
                     probability=dict(zip(LABELS,p)),legacy=dict(zip(LABELS,bp))) for e,(p,y),(bp,_) in zip(test,pairs,legacy)])
    (DATA/'model_validation_v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    artifact=dict(version=VERSION,selected=winner,accepted=accepted,trained_through='2025-12-31',features=FEATURES,
                  weights=weights,history_sha256=report['source_sha256'])
    (DATA/'model_v2.json').write_text(json.dumps(artifact,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='replay'},ensure_ascii=False,indent=2))


if __name__=='__main__': main()
