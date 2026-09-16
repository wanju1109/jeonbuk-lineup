"""Collect official Jeonbuk all-time search cards and profiles; resume cached profiles."""
import json
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'player_report/scripts'))
import collect_players as source

def main():
    dest = ROOT / 'player_quiz/data/history.json'
    previous = json.loads(dest.read_text(encoding='utf-8')) if dest.exists() else {}
    profiles = previous.get('players', {})
    cards = {}
    urls = []
    for pos in ('gk', 'df', 'mf', 'fw'):
        page, last = 1, 1
        while page <= last:
            url = f'{source.BASE}/player.do?type=all&teamId=K05&pos={pos}&page={page}'
            html = source.fetch(url)
            last = source.last_page(html)
            rows = source.parse_list_cards(html, 'K05', pos)
            if not rows:
                if page == 1:
                    raise RuntimeError(f'Empty official page: {url}')
                break
            cards.update({p['id']: p for p in rows})
            urls.append(url)
            print(pos, page, last, len(rows), flush=True)
            page += 1
            time.sleep(.2)
    listed_ids = sorted(cards)
    # The official search now classifies Lee Dong-gook as staff; confirm his
    # Jeonbuk playing seasons from playerDetail instead of assigning a fake role.
    for pid in ('19980443',):
        cards.setdefault(pid, {'id': pid, 'kleague_photo': ''})
    errors = []
    for i, (pid, card) in enumerate(cards.items()):
        if pid in profiles:
            continue
        cached = ROOT / f'player_report/data/players/{pid}.json'
        try:
            if cached.exists():
                p = json.loads(cached.read_text(encoding='utf-8'))
            else:
                p = source.parse_detail(source.fetch(f'{source.BASE}/record/playerDetail.do?playerId={pid}'), pid)
                time.sleep(.2)
            if pid == '19980443' and not any('전북' in s.get('team', '') for s in p.get('seasons', [])):
                raise ValueError('Supplement lacks official Jeonbuk playing record')
            if not p.get('name'):
                raise ValueError('No profile name')
            # Search membership is authoritative, including registered non-appearance players.
            profiles[pid] = {k: p.get(k) for k in ('id','name','position','nation','height','birth','seasons','teams')}
            profiles[pid]['photo'] = card.get('kleague_photo', '')
        except Exception as exc:
            errors.append({'id': pid, 'error': str(exc)})
        if i % 20 == 0:
            print('profiles', i, '/', len(cards), flush=True)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps({**previous, 'players': profiles}, ensure_ascii=False), encoding='utf-8')
    result = {'collected_at': datetime.now(timezone.utc).isoformat(), 'source_urls': urls,
              'official_ids': listed_ids, 'players': profiles, 'errors': errors,
              'supplemental_ids': ['19980443'],
              'supplemental_sources': [f'{source.BASE}/record/playerDetail.do?playerId=19980443']}
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('DONE', len(cards), 'official;', len(profiles), 'profiles;', len(errors), 'errors')
    return bool(errors)

if __name__ == '__main__':
    raise SystemExit(main())
