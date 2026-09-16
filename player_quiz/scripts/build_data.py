"""Freeze a content-addressed quiz dataset; preserve every published version."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'player_quiz/data'
def stat_hints(player, year):
    """Aggregate same-season transfers; exclude cups/PO and unknown values."""
    hints = []
    seasons = player.get('seasons') or []
    current = [s for s in seasons if str(s.get('season')) == str(year)]
    # Retired players get their most recent recorded season, explicitly dated.
    if not current and seasons:
        recorded = [str(s.get('season')) for s in seasons if str(s.get('season', '')).isdigit()]
        if recorded:
            year = max(recorded)
            current = [s for s in seasons if str(s.get('season')) == year]
    def add(rows, prefix, category):
        for comp, label in [('k1', 'K리그1'), ('k2', 'K리그2')]:
            blocks = [r[comp] for r in rows if isinstance(r.get(comp), dict) and r[comp].get('apps') is not None]
            if not blocks: continue
            def total(key):
                values = [b.get(key) for b in blocks]
                return sum(values) if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values) else None
            apps = total('apps')
            if apps is None: continue
            hints.append([f'{prefix} {label} 출장', f'{apps}경기', category])
            # A single rich record hint avoids treating three similar stats as variety.
            parts = [f'{apps}경기']
            fields = [('goals_conceded','실점'),('clean_sheets','클린시트')] if player.get('position') == 'GK' else [('goals','골'),('assists','도움')]
            for key, unit in fields:
                value = total(key)
                if value is not None: parts.append(f'{value}{unit}')
            if len(parts) > 1: hints.append([f'{prefix} {label} 기록', ' · '.join(parts), category])
    if current: add(current, f'{year}시즌', 'season')
    # Team rows are disjoint; unlike season rows they also cover legacy records.
    teams = player.get('teams') or []
    if teams:
        add(teams, '통산', 'career')
        jb = [r for r in teams if '전북' in r.get('team','')]
        if jb: add(jb, '전북 소속 통산', 'career')
    return hints

def highlight_hints(player):
    """Milestones are lower bounds supported by recorded league values, not rankings."""
    hints = []
    teams = player.get('teams') or []
    for selected, prefix in [(teams, 'K리그1·2'), ([t for t in teams if '전북' in t.get('team','')], '전북 소속 K리그1·2')]:
        blocks = [t.get(comp) or {} for t in selected for comp in ('k1','k2')]
        for key, unit, thresholds in [('apps','경기',[500,400,300,200,100]),('goals','골',[200,150,100,50]),('assists','도움',[100,80,50])]:
            values = [b.get(key) for b in blocks if isinstance(b.get(key), int) and b[key]>=0]
            total = sum(values)
            threshold = next((n for n in thresholds if total>=n), None)
            if threshold: hints.append([f'{prefix} 이정표', f'통산 {threshold}{unit} 이상을 기록한 선수', 'highlight'])
    years = {str(s.get('season')) for s in player.get('seasons', []) if '전북' in s.get('team','')}
    threshold = next((n for n in [15,10,5] if len(years)>=n),None)
    if threshold: hints.append(['전북과 함께한 시즌',f'전북 소속으로 기록을 남긴 시즌이 {threshold}시즌 이상', 'highlight'])
    return hints

def build():
    index = json.loads((ROOT / 'player_report/data/index.json').read_text(encoding='utf-8'))
    history = json.loads((OUT / 'history.json').read_text(encoding='utf-8-sig'))
    current = {}
    for league in index['leagues']:
        for team in league['teams']:
            for card in team['players']:
                current[card['id']] = (card, team, league)
    records = {}
    for pid in sorted(set(current) | set(history['official_ids']) | set(history.get('supplemental_ids', []))):
        path = ROOT / f'player_report/data/players/{pid}.json'
        p = json.loads(path.read_text(encoding='utf-8')) if path.exists() else history['players'].get(pid, {})
        if not p.get('name'): continue
        entry = current.get(pid)
        card, team, league = entry if entry else ({}, {}, {})
        seasons = p.get('seasons') or []
        jb = pid in history['official_ids'] or team.get('id') == 'K05' or any('전북' in s.get('team','') for s in seasons)
        hints = []
        if p.get('position') in ('GK','DF','MF','FW'): hints.append(['포지션', {'GK':'골키퍼','DF':'수비수','MF':'미드필더','FW':'공격수'}.get(p['position'],p['position'])])
        if entry: hints.append([f"{index['year']} 등록 구단", team['full']])
        jb_years = sorted({s['season'] for s in seasons if '전북' in s.get('team','')})
        if jb_years:
            hints.append(['전북에서 기록을 남긴 시즌', ', '.join(jb_years), 'career'])
            hints.append(['전북 기록이 있는 시즌 수', f'{len(jb_years)}시즌', 'career'])
        teams = list(dict.fromkeys(s['team'] for s in seasons if s.get('team')))
        if teams: hints.append(['K리그 기록에 등장하는 팀', ' · '.join(teams)])
        if entry and card.get('back_no') is not None: hints.append([f"{index['year']} 등번호", str(card['back_no'])])
        jb_records = [t for t in (p.get('teams') or []) if '전북' in t.get('team','')]
        if jb_records:
            apps = sum((t.get('k1') or {}).get('apps') or 0 for t in jb_records)
            if apps: hints.append(['전북 K리그1 통산 출장', f'{apps}경기'])
        hints.extend(stat_hints(p, index['year']))
        hints.extend(highlight_hints(p))
        if len(hints) < 5: continue
        records[pid] = {'id':pid, 'name':p['name'], 'position':p.get('position',''),
            'current':bool(entry), 'team':team.get('id'), 'league':str(league.get('id','')), 'jeonbuk':jb,
            'statsAsOf':(p.get('fetched_at') or '')[:10], 'hints':hints, 'photo':card.get('photo') or p.get('photo') or (p.get('photos') or {}).get('kleague',''),
            'source':f'https://www.kleague.com/record/playerDetail.do?playerId={pid}'}
    data = {'schema':1, 'hintPolicy':4, 'season':index['year'], 'asOf':index['updated_at'][:10],
            'historyAsOf':history['collected_at'][:10], 'historyListed':len(history['official_ids']),
            'players':list(records.values())}
    raw = json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
    version = hashlib.sha256(raw).hexdigest()[:16]
    (OUT / f'{version}.json').write_bytes(raw)
    (OUT / 'manifest.json').write_text(json.dumps({'version':version}),encoding='utf-8')
    print(version, len(records), 'players;', sum(p['jeonbuk'] for p in records.values()), 'Jeonbuk past/present')
if __name__ == '__main__': build()
