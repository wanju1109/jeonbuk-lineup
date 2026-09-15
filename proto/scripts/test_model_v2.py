import copy
import json
import unittest
from datetime import datetime, timedelta

from prediction_model import replay_features
from publish_model_predictions import refresh, KST
from validate_model_v2 import DATA


class ModelTests(unittest.TestCase):
    def test_same_day_results_do_not_enter_features(self):
        rows=json.loads((DATA/'official_history.json').read_text(encoding='utf-8'))['matches'][:20]
        day=rows[10]['date']
        changed=copy.deepcopy(rows)
        for m in changed:
            if m['date']>=day: m['score']=[9,0]
        a=replay_features(rows); b=replay_features(list(reversed(changed)))
        for left,right in zip(a,b):
            if left['match']['date']<=day:
                self.assertEqual(left['x'],right['x'])
                self.assertEqual(left['poisson'],right['poisson'])

    def test_publication_never_rewrites_past_picks(self):
        history=json.loads((DATA/'official_history.json').read_text(encoding='utf-8'))['matches']
        league=json.loads((DATA/'league.json').read_text(encoding='utf-8'))
        original=copy.deepcopy(league)
        model=json.loads((DATA/'model_v2.json').read_text(encoding='utf-8'))
        now=datetime(2026,9,15,12,tzinfo=KST)
        first=refresh(league,history,model,{},now)
        self.assertTrue(first['predictions'])
        after=refresh(league,history,model,first,now+timedelta(days=100))
        for mid,p in first['predictions'].items(): self.assertEqual(p,after['predictions'][mid])
        self.assertEqual(league,original)
        for p in first['predictions'].values():
            self.assertLess(p['generated_at'],p['kickoff'])
            self.assertLess(p['data_through'],'2026-09-15')
            self.assertAlmostEqual(sum(p['dist'].values()),1)
            self.assertEqual(p['prob'],max(p['dist'].values()))


if __name__=='__main__':unittest.main()
