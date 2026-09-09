import copy
import json
import unittest

from validate_predictions import DATA, forecast


class ChronologyTests(unittest.TestCase):
    def test_same_day_and_future_results_cannot_change_forecast(self):
        rows = json.loads((DATA/'league.json').read_text(encoding='utf-8'))['matches']
        target = next(m for m in rows if m['date'] >= '2026-07-22')
        changed = copy.deepcopy(rows)
        for m in changed:
            if m['date'] >= target['date']:
                m['finished'] = True
                m['score'] = [9, 0]
        for shrink in (None, 4, 8, 16):
            self.assertEqual(forecast(rows, target, shrink), forecast(changed, target, shrink))

    def test_probabilities_and_input_preservation(self):
        rows = json.loads((DATA/'league.json').read_text(encoding='utf-8'))['matches']
        before = copy.deepcopy(rows)
        for target in (rows[0], rows[-1]):
            for shrink in (None, 4, 8, 16):
                p = forecast(rows, target, shrink)
                self.assertAlmostEqual(sum(p.values()), 1, places=3)
                self.assertTrue(all(0 <= v <= 1 for v in p.values()))
        self.assertEqual(rows, before)


if __name__ == '__main__':
    unittest.main()
