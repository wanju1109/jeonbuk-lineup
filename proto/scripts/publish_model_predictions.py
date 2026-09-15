"""Save prospective research forecasts; never replace original picks or past forecasts."""
import json
from datetime import datetime, timedelta, timezone

from prediction_model import LABELS, State, VERSION, predict
from update_results import key_team
from validate_model_v2 import DATA

KST = timezone(timedelta(hours=9))


def refresh(league, history, artifact, published, now):
    if artifact['version'] != VERSION:
        raise ValueError('Model version mismatch')
    names = {}
    for m in history:
        names[(m['league'],key_team(m['home']))] = m['home_id']
        names[(m['league'],key_team(m['away']))] = m['away_id']
    state=State()
    # Conservative daily cutoff. No same-day result can enter any forecast.
    cutoff=now.date().isoformat()
    prior=[m for m in history if m['date']<cutoff]
    for day in sorted({m['date'] for m in prior}):
        state.update_batch([m for m in prior if m['date']==day])
    out=json.loads(json.dumps(published))
    predictions=out.setdefault('predictions',{})
    for m in league['matches']:
        if m.get('finished') or not m.get('date'):
            continue
        kickoff=datetime.fromisoformat(m['date']+'T'+(m.get('time') or '00:00')).replace(tzinfo=KST)
        if kickoff<=now or kickoff>now+timedelta(days=14):
            continue
        old=predictions.get(m['id'])
        # Freeze the last forecast as kickoff approaches; never write a post-kickoff pick.
        if old and kickoff-now<=timedelta(hours=24):
            continue
        target=dict(m,home_id=names.get((m['league'],key_team(m['home']))),
                    away_id=names.get((m['league'],key_team(m['away']))))
        if not target['home_id'] or not target['away_id']:
            continue
        features=state.features(target)
        p=predict(features,artifact['selected'],artifact['weights'])
        dist=dict(zip(LABELS,p)); pick=max(dist,key=dist.get)
        record=dict(version=VERSION,model=artifact['selected'],generated_at=now.isoformat(),
                    data_through=max((m['date'] for m in prior),default=None),
                    kickoff=kickoff.isoformat(),pick=pick,prob=dist[pick],dist=dist,evidence=features['evidence'])
        if old:
            record['previous']=old.get('previous',[])+[{k:v for k,v in old.items() if k!='previous'}]
        predictions[m['id']]=record
    out.update(version=VERSION,mode='shadow',updated_at=now.isoformat(),
               explanation='Research forecasts, separate from saved picks. Daily refresh up to 24h before kickoff; past forecasts preserved.')
    return out


def main():
    league=json.loads((DATA/'league.json').read_text(encoding='utf-8'))
    history=json.loads((DATA/'official_history.json').read_text(encoding='utf-8'))['matches']
    artifact=json.loads((DATA/'model_v2.json').read_text(encoding='utf-8'))
    path=DATA/'model_predictions.json'
    published=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    result=refresh(league,history,artifact,published,datetime.now(KST))
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Research forecasts saved: {len(result["predictions"])}; original picks unchanged.')


if __name__=='__main__':main()
