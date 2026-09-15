"""Small, reproducible WDL models. Standard library only; no odds or future labels."""
import math
from collections import defaultdict
from datetime import date
from itertools import groupby

LABELS = ('승', '무', '패')
VERSION = 'chronological-v2'
FEATURES = ('bias', 'k2', 'elo_difference', 'goal_difference', 'points_difference',
            'recent_points_difference', 'draw_tendency', 'absolute_elo_difference')


def softmax(values):
    top = max(values)
    exps = [math.exp(v-top) for v in values]
    return [x/sum(exps) for x in exps]


def poisson(home, away):
    out = [0., 0., 0.]
    for h in range(17):
        ph = math.exp(-home)*home**h/math.factorial(h)
        for a in range(17):
            p = ph*math.exp(-away)*away**a/math.factorial(a)
            out[0 if h>a else 2 if h<a else 1] += p
    return [p/sum(out) for p in out]


def outcome(m):
    return 0 if m['score'][0]>m['score'][1] else 2 if m['score'][0]<m['score'][1] else 1


class State:
    def __init__(self):
        self.ratings = defaultdict(float)
        self.games = defaultdict(list)
        self.leagues = defaultdict(list)

    def features(self, m):
        today = date.fromisoformat(m['date'])
        def record(team):
            games = self.games[(m['league'], team)]
            n = gf = ga = points = draws = 0.
            recent = []
            for day, scored, conceded in games:
                weight = 2 ** (-(today-day).days / 180)
                n += weight
                gf += weight*scored
                ga += weight*conceded
                pts = 3 if scored>conceded else 0 if scored<conceded else 1
                points += weight*pts
                draws += weight*(scored==conceded)
                recent.append(pts)
            return dict(gf=(gf+6.5)/(n+5), ga=(ga+6.5)/(n+5),
                        gd=(gf-ga)/(n+5), ppg=(points+6.5)/(n+5),
                        draws=(draws+1.5)/(n+5), form=(sum(recent[-5:])+2.6)/(min(5,len(recent))+2), n=len(games))
        h, a = record(m['home_id']), record(m['away_id'])
        elo = (self.ratings[(m['league'],m['home_id'])]-self.ratings[(m['league'],m['away_id'])])/400
        features = [1., float(m['league']=='K2'), elo, h['gd']-a['gd'],
                    h['ppg']-a['ppg'], h['form']-a['form'], h['draws']+a['draws']-.6, abs(elo)]
        # Pooled home/away games reduce split-sample noise. Decay weights use dates.
        league = self.leagues[m['league']]
        hg, ag, n = 12*1.3, 12*1.1, 12.
        for day, hs, aws in league:
            w = 2 ** (-(today-day).days/180)
            hg += hs*w; ag += aws*w; n += w
        hg /= n; ag /= n
        avg = (hg+ag)/2
        xh = max(.25,min(4, hg*h['gf']*a['ga']/avg**2))
        xa = max(.25,min(4, ag*a['gf']*h['ga']/avg**2))
        # Davidson-style draw mass over an Elo win-strength ratio.
        strength = 10**(elo+60/400)
        draw = .85*math.sqrt(strength)
        elo_dist = [v/(strength+draw+1) for v in (strength,draw,1.)]
        return dict(x=features, poisson=poisson(xh,xa), elo=elo_dist,
                    evidence=dict(home_games=h['n'], away_games=a['n'],
                                  home_ppg=round(h['ppg'],3),away_ppg=round(a['ppg'],3),
                                  home_form=round(h['form'],3),away_form=round(a['form'],3),
                                  elo_difference=round(elo*400,1)))

    def update_batch(self, rows):
        deltas = defaultdict(float)
        for m in rows:
            hk, ak = (m['league'],m['home_id']), (m['league'],m['away_id'])
            diff = self.ratings[hk]-self.ratings[ak]+60
            expected = 1/(1+10**(-diff/400))
            result = (1.,.5,0.)[outcome(m)]
            delta = 24*(result-expected)
            deltas[hk] += delta; deltas[ak] -= delta
            day = date.fromisoformat(m['date']); h,a=m['score']
            self.games[hk].append((day,h,a)); self.games[ak].append((day,a,h))
            self.leagues[m['league']].append((day,h,a))
        for team, delta in deltas.items():
            self.ratings[team] += delta


def replay_features(rows):
    state = State(); examples = []
    for _, group in groupby(sorted(rows,key=lambda m:(m['date'],m['id'])), key=lambda m:m['date']):
        batch = list(group)
        for m in batch:
            examples.append(dict(match=m, **state.features(m), y=outcome(m)))
        state.update_batch(batch)
    return examples


def fit(examples, penalty):
    """Ridge multinomial regression fitted on prior seasons only."""
    weights = [[0.]*len(FEATURES) for _ in LABELS]
    n = len(examples)
    for _ in range(400):
        grad = [[0.]*len(FEATURES) for _ in LABELS]
        for e in examples:
            x = e['x']; probs = softmax([sum(a*b for a,b in zip(w,x)) for w in weights])
            for k in range(3):
                error = probs[k]-(e['y']==k)
                for j,v in enumerate(x): grad[k][j] += error*v
        for k in range(3):
            for j in range(len(FEATURES)):
                weights[k][j] -= .3*(grad[k][j]/n + (penalty*weights[k][j] if j>1 else 0))
    return weights


def predict(features, name, weights=None):
    if name in ('poisson','elo'): return features[name]
    learned = softmax([sum(a*b for a,b in zip(w,features['x'])) for w in weights])
    if name == 'ensemble':
        return [(a+b+c)/3 for a,b,c in zip(learned,features['poisson'],features['elo'])]
    return learned
