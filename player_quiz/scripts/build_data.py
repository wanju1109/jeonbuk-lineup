"""Freeze a content-addressed quiz dataset; preserve every published version."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'player_quiz/data'
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
        if p.get('nation'): hints.append(['국적', p['nation']])
        if p.get('position') in ('GK','DF','MF','FW'): hints.append(['포지션', {'GK':'골키퍼','DF':'수비수','MF':'미드필더','FW':'공격수'}.get(p['position'],p['position'])])
        if p.get('birth'): hints.append(['생년월일', p['birth']])
        if p.get('height'): hints.append(['신장', f"{p['height']}cm"])
        if entry: hints.append([f"{index['year']} 등록 구단", team['full']])
        jb_years = sorted({s['season'] for s in seasons if '전북' in s.get('team','')})
        if jb_years: hints.append(['전북 시즌 기록', ', '.join(jb_years)])
        teams = list(dict.fromkeys(s['team'] for s in seasons if s.get('team')))
        if teams: hints.append(['K리그 기록에 등장하는 팀', ' · '.join(teams)])
        if entry and card.get('back_no') is not None: hints.append([f"{index['year']} 등번호", str(card['back_no'])])
        jb_records = [t for t in (p.get('teams') or []) if '전북' in t.get('team','')]
        if jb_records:
            apps = sum((t.get('k1') or {}).get('apps') or 0 for t in jb_records)
            if apps: hints.append(['전북 K리그1 통산 출장', f'{apps}경기'])
        if len(hints) < 5: continue
        records[pid] = {'id':pid, 'name':p['name'], 'position':p.get('position',''), 'birth':p.get('birth',''),
            'current':bool(entry), 'team':team.get('id'), 'league':str(league.get('id','')), 'jeonbuk':jb,
            'hints':hints, 'photo':card.get('photo') or p.get('photo') or (p.get('photos') or {}).get('kleague',''),
            'source':f'https://www.kleague.com/record/playerDetail.do?playerId={pid}'}
    data = {'schema':1, 'season':index['year'], 'asOf':index['updated_at'][:10],
            'historyAsOf':history['collected_at'][:10], 'historyListed':len(history['official_ids']),
            'players':list(records.values())}
    raw = json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
    version = hashlib.sha256(raw).hexdigest()[:16]
    (OUT / f'{version}.json').write_bytes(raw)
    (OUT / 'manifest.json').write_text(json.dumps({'version':version}),encoding='utf-8')
    print(version, len(records), 'players;', sum(p['jeonbuk'] for p in records.values()), 'Jeonbuk past/present')
if __name__ == '__main__': build()
