"""Reproducible current-league performance scores, independent of names/reputation."""
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / 'proto/data/official_history.json'
VERSION = 'league-performance-v1'
WEIGHTS = {'results': .5, 'change': .3, 'recent': .2}
# Attribution boundaries, never score overrides. Appointment-day games are excluded.
MIDSEASON = {
    'K17': ('2026-04-21', 'https://www.kleague.com/news_view.do?seq=94950'),
    'K08': ('2026-08-12', 'https://biz.chosun.com/sports/football/2026/08/11/GRQWEY3FGE4TCOLEGE2DKYTFGU/'),
    'K07': ('2026-05-01', 'https://www.transfermarkt.co.kr/kwan-sik-lim/profil/trainer/65581'),
}


def clip(x): return min(100.,max(0.,x))


def record(rows, team):
    games=[]
    for m in sorted(rows,key=lambda m:(m['date'],m['id'])):
        side=0 if m['home_id']==team else 1 if m['away_id']==team else None
        if side is None: continue
        gf,ga=m['score'][side],m['score'][1-side]
        games.append(dict(id=m['id'],date=m['date'],gf=gf,ga=ga,points=3 if gf>ga else 1 if gf==ga else 0))
    n=len(games); points=sum(g['points'] for g in games)
    return dict(n=n,points=points,ppg=points/n if n else None,games=games)


def average(rows):
    return sum(2 if m['score'][0]==m['score'][1] else 3 for m in rows)/(2*len(rows)) if rows else 1.35


def adjusted(rec, avg, prior=8):
    return (rec['points']+prior*avg)/(rec['n']+prior)


def percentile(value, peers):
    # Midrank percentile, including ties. All equals = 50, not all 100.
    if not peers: return 50.
    return 100*(sum(p<value-1e-9 for p in peers)+.5*sum(abs(p-value)<1e-9 for p in peers))/len(peers)


def score_one(coach, history, season):
    base=dict(version=VERSION,status='unavailable',score=None,components=[],season=season)
    if season != 2026:
        return dict(base,reason='새 시즌 감독 재임 구간 확인 필요')
    if coach['league'] not in ('K1','K2') or not coach['club_id']:
        return dict(base,reason='동일 기준의 현재 K리그 재임 경기 자료 없음. 대표팀·해외·무직을 낮은 점수로 환산하지 않습니다.')
    team=coach['club_id']; lg=coach['league']
    start, source=MIDSEASON.get(team,(f'{season}-01-01','team_report/data/team_profiles.json + 기존 개막 감독 프로필'))
    if not start.startswith(str(season)):
        return dict(base,reason='새 시즌 재임 구간 확인 필요')
    all_season=[m for m in history if m['season']==season and m['league']==lg]
    period=[m for m in all_season if m['date']>=start]
    rec=record(period,team)
    if rec['n']<8:
        return dict(base,start=start,source=source,n=rec['n'],reason=f'재임 후 {rec["n"]}경기. 최소 8경기 전까지 평가 보류.')
    teams=sorted({m[k] for m in period for k in ('home_id','away_id')})
    avg=average(period)
    records={t:record(period,t) for t in teams}
    current=adjusted(rec,avg)
    season_score=percentile(current,[adjusted(r,avg) for r in records.values()])
    recent={t:dict(n=len(r['games'][-8:]),points=sum(g['points'] for g in r['games'][-8:])) for t,r in records.items()}
    recent_score=percentile(adjusted(recent[team],avg),[adjusted(r,avg) for r in recent.values()])
    # Midseason successor compared with predecessor's season; otherwise previous season in same league.
    prior=[m for m in all_season if m['date']<start] if start>f'{season}-01-01' else [m for m in history if m['season']==season-1 and m['league']==lg]
    previous=record(prior,team); previous_avg=average(prior)
    if previous['n']>=8:
        # Compare performance relative to each period's own league scoring environment.
        delta=(current-avg)-(adjusted(previous,previous_avg)-previous_avg)
        change_score=clip(50+40*delta)
        comparison='재임 전 같은 시즌' if start>f'{season}-01-01' else '전년 같은 리그'
    else:
        delta=None;change_score=50.;comparison='동일 리그 이전 표본 부족 → 중립 50점'
    components=[dict(key=k,label=label,score=round(score,3),weight=WEIGHTS[k],contribution=round(score*WEIGHTS[k],3))
                for k,label,score in [('results','재임 성과',season_score),('change','기준 대비 변화',change_score),('recent','최근 8경기',recent_score)]]
    total=round(sum(c['contribution'] for c in components),1)
    return dict(base,status='scored',score=total,start=start,source=source,n=rec['n'],
                through=max(g['date'] for g in rec['games']),components=components,
                reason=f'재임 성과 50% + 기준 대비 변화 30% + 최근 8경기 20%. {rec["n"]}경기 기준.',
                inputs=dict(points=rec['points'],ppg=round(rec['ppg'],4),adjusted_ppg=round(current,4),
                    league_ppg=round(avg,4),recent_n=recent[team]['n'],recent_points=recent[team]['points'],
                    previous_n=previous['n'],previous_ppg=round(previous['ppg'],4) if previous['ppg'] is not None else None,
                    comparison=comparison,relative_change=round(delta,4) if delta is not None else None),
                game_ids=[g['id'] for g in rec['games']])


def apply_scores(coaches):
    raw=HISTORY.read_bytes(); history=json.loads(raw)['matches']; season=max(m['season'] for m in history)
    audit=[]
    for coach in coaches:
        old=coach.get('editorial_rating',coach['rating'])
        performance=score_one(coach,history,season)
        coach['editorial_rating']=old
        coach['performance']=performance
        coach['rating']=performance['score']
        coach['rating_note']=performance['reason']
        audit.append(dict(id=coach['id'],name=coach['name'],old_editorial=old,new=coach['rating'],**performance))
    report=dict(version=VERSION,as_of=max(m['date'] for m in history),source_sha256=hashlib.sha256(raw).hexdigest(),
                weights=WEIGHTS,minimum_games=8,prior_games=8,coaches=audit)
    path=ROOT/'korea_coach/data/scoring_audit.json'
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report
