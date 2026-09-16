import unittest
from build_data import stat_hints

class RecordsTests(unittest.TestCase):
    def test_transfers_sum_only_league_not_cup(self):
        p={'position':'FW','seasons':[{'season':'2026','team':'전북','k1':{'apps':10,'goals':2,'assists':1},'cup':{'apps':99,'goals':99}}, {'season':'2026','team':'서울','k1':{'apps':5,'goals':3,'assists':2}}]}
        h={x[0]:x[1] for x in stat_hints(p,2026)}
        self.assertEqual(h['2026시즌 K리그1 출장'],'15경기')
        self.assertEqual(h['2026시즌 K리그1 기록'],'15경기 · 5골 · 3도움')
    def test_unknown_is_not_zero(self):
        p={'position':'MF','seasons':[{'season':'2026','k1':{'apps':2,'goals':None,'assists':0}}]}
        h=stat_hints(p,2026)
        self.assertTrue(any('0도움' in x[1] for x in h))
        self.assertFalse(any('골' in x[1] for x in h))
        self.assertFalse(any('K리그2' in x[0] for x in h))
    def test_gk_and_retired_season(self):
        p={'position':'GK','seasons':[{'season':'2020','k1':{'apps':20,'goals_conceded':15,'clean_sheets':8}}]}
        h=stat_hints(p,2026)
        self.assertTrue(any('2020시즌' in x[0] and '15실점' in x[1] and '8클린시트' in x[1] for x in h))
        self.assertFalse(any('2026' in x[0] for x in h))
    def test_current_dataset_no_personal_hints(self):
        import json
        from pathlib import Path
        folder=Path(__file__).resolve().parents[1]/'data'
        version=json.loads((folder/'manifest.json').read_text())['version']
        data=json.loads((folder/f'{version}.json').read_text(encoding='utf-8'))
        for p in data['players']:
            self.assertFalse(any(h[0] in ['국적','생년월일','신장','몸무게'] for h in p['hints']))
            self.assertNotIn('birth',p)
        self.assertTrue(any(any('시즌 K리그1 기록' in h[0] for h in p['hints']) for p in data['players']))

if __name__=='__main__': unittest.main()
