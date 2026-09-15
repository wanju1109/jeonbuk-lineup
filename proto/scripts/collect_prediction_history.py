"""Fetch public official schedules for reproducible prediction research."""
import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

DATA = Path(__file__).resolve().parents[1] / 'data'
URL = 'https://www.kleague.com/getScheduleList.do'


def fetch_month(year, league, month):
    query = dict(leagueId=str(league), year=str(year), month=f'{month:02}', teamId='', ticketYn='')
    request = Request(URL, json.dumps(query).encode(), {'Content-Type': 'application/json',
                      'Referer': 'https://www.kleague.com/schedule.do'})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
            payload = json.loads(raw)
            if payload.get('resultCode') != '200':
                raise ValueError(f'API result {payload.get("resultCode")}')
            return payload['data'].get('scheduleList') or [], hashlib.sha256(raw).hexdigest()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-year', type=int, default=2023)
    parser.add_argument('--to-year', type=int, default=2026)
    args = parser.parse_args()
    target = DATA / 'official_history.json'
    existing = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'matches': [], 'requests': []}
    # Past seasons can be reused. Current season is refreshed explicitly.
    now = datetime.now(timezone.utc)
    matches = {m['id']: m for m in existing['matches']}
    requests = {(r['year'], r['league'], r['month']): r for r in existing['requests']}
    for year in range(args.from_year, args.to_year + 1):
        for league in (1, 2):
            for month in range(1, 13):
                key = (year, league, month)
                if year < now.year and key in requests:
                    continue
                rows, digest = fetch_month(*key)
                for row in rows:
                    if row.get('endYn') != 'Y':
                        continue
                    hs, aws = row.get('homeGoal'), row.get('awayGoal')
                    if not isinstance(hs, int) or not isinstance(aws, int) or min(hs, aws) < 0:
                        raise ValueError(f'Invalid final score: {row}')
                    mid = f"{year}-K{league}-{row['gameId']}"
                    matches[mid] = dict(id=mid, season=year, league=f'K{league}',
                        round=row['roundId'], date=row['gameDate'].replace('.', '-'), time=row['gameTime'],
                        home=row['homeTeamName'], away=row['awayTeamName'],
                        home_id=row['homeTeam'], away_id=row['awayTeam'], score=[hs, aws], finished=True)
                requests[key] = dict(year=year, league=league, month=month, sha256=digest, fetched_at=now.isoformat())
                time.sleep(.1)
            print(f'{year} K{league}: {sum(m["season"]==year and m["league"]==f"K{league}" for m in matches.values())}', flush=True)
            payload = dict(source=URL, fetched_at=now.isoformat(), requests=list(requests.values()),
                           matches=sorted(matches.values(), key=lambda m:(m['date'],m['id'])))
            target.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
