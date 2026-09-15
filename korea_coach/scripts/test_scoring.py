import copy
import json
import unittest

from score_coaches import HISTORY, ROOT, score_one, percentile


class FairScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.history=json.loads(HISTORY.read_text(encoding='utf-8'))['matches']
        cls.coaches=json.loads((ROOT/'korea_coach/data/coaches.json').read_text(encoding='utf-8'))['coaches']

    def test_name_reputation_and_editorial_rating_do_not_affect_score(self):
        c=copy.deepcopy(self.coaches[0]); expected=score_one(c,self.history,2026)
        c.update(id='changed',name='다른 이름',rating=100,editorial_rating=0,abilities=[])
        self.assertEqual(score_one(c,self.history,2026),expected)

    def test_ties_and_missing_data(self):
        self.assertEqual(percentile(1.5,[1.5]*12),50)
        c=dict(self.coaches[0],club_id='unknown')
        self.assertIsNone(score_one(c,self.history,2026)['score'])
        c=dict(self.coaches[0],league='ETC')
        self.assertIsNone(score_one(c,self.history,2026)['score'])

    def test_components_and_midseason_attribution(self):
        for c in self.coaches:
            p=score_one(c,self.history,2026)
            if p['score'] is None: continue
            self.assertAlmostEqual(sum(x['weight'] for x in p['components']),1)
            self.assertEqual(round(sum(x['contribution'] for x in p['components']),1),p['score'])
            self.assertTrue(0<=p['score']<=100)
            by_id={m['id']:m for m in self.history}
            self.assertTrue(all(by_id[mid]['date']>=p['start'] for mid in p['game_ids']))

    def test_better_result_cannot_lower_same_coach_score(self):
        c=self.coaches[0]; original=score_one(c,self.history,2026)
        changed=copy.deepcopy(self.history)
        match=next(m for m in reversed(changed) if m['season']==2026 and m['home_id']==c['club_id'] and m['score'][0]<=m['score'][1])
        match['score']=[match['score'][1]+1,match['score'][1]]
        self.assertGreaterEqual(score_one(c,changed,2026)['score'],original['score'])


if __name__=='__main__':unittest.main()
