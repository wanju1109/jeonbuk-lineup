#!/usr/bin/env python3
"""Grid-search WDL mode + Poisson knobs on honest walk-forward backtest."""
from __future__ import annotations

import itertools
import json
import os
import sys

import analyze as A


def eval_once(wdl_mode: str, home_adv: float, ou_bias: float, shrink: float) -> dict:
    A.HOME_ADV = home_adv
    A.OU_UNDER_BIAS = ou_bias
    A.FAVORITE_SHRINK = shrink
    A.WDL_PICK_MODE = wdl_mode  # patched below

    orig_predict = A.predict_match

    def predict_match(*args, **kwargs):
        mk = orig_predict(*args, **kwargs)
        mode = getattr(A, "WDL_PICK_MODE", "gd")
        if mode == "poisson":
            poi = mk.get("poisson_wdl") or {}
            if poi.get("pick"):
                dist = dict(poi.get("dist") or mk["wdl"]["dist"])
                mk["wdl"] = {
                    "pick": poi["pick"],
                    "prob": float(dist.get(poi["pick"], 0.0)),
                    "dist": dist,
                }
        elif mode == "agree":
            poi = mk.get("poisson_wdl") or {}
            gd = mk.get("wdl_model") or {}
            gp = gd.get("pick")
            pp = poi.get("pick")
            dist = dict(mk["wdl"]["dist"])
            if gp and pp and gp == pp:
                pick = gp
            elif pp:
                pick = pp
            else:
                pick = mk["wdl"]["pick"]
            mk["wdl"] = {
                "pick": pick,
                "prob": float(dist.get(pick, 0.0)),
                "dist": dist,
            }
        elif mode == "conf":
            poi = mk.get("poisson_wdl") or {}
            gd = mk.get("wdl_model") or {}
            dist = dict(mk["wdl"]["dist"])
            vals = sorted(dist.items(), key=lambda x: -x[1])
            gap = vals[0][1] - vals[1][1] if len(vals) > 1 else vals[0][1]
            if gap >= 0.12:
                pick = vals[0][0]
            elif poi.get("pick"):
                pick = poi["pick"]
            else:
                pick = gd.get("pick") or mk["wdl"]["pick"]
            mk["wdl"] = {
                "pick": pick,
                "prob": float(dist.get(pick, 0.0)),
                "dist": dist,
            }
        return mk

    A.predict_match = predict_match
    A.CURRENT_OVERRIDES = {}
    out = A.run()
    A.predict_match = orig_predict

    keys = ("wdl", "h_p1", "ou25")
    res = {}
    for lg in ("K1", "K2"):
        s = out["summary"][lg]
        res[lg] = {k: s["rates"][k] for k in keys}
        res[lg]["n"] = s["wdl_total"]
    res["all"] = {
        k: round(
            100.0
            * sum(out["summary"][lg]["hits"][k]["hit"] for lg in ("K1", "K2"))
            / sum(out["summary"][lg]["hits"][k]["total"] for lg in ("K1", "K2")),
            2,
        )
        for k in keys
    }
    return res


def main() -> None:
    modes = ("gd", "poisson", "agree", "conf")
    home_advs = (0.14, 0.18, 0.22)
    ou_biases = (-0.05, 0.0, 0.05)
    shrinks = (0.0,)

    best = None
    rows = []
    for mode, ha, ou, sh in itertools.product(modes, home_advs, ou_biases, shrinks):
        r = eval_once(mode, ha, ou, sh)
        score = r["all"]["wdl"] * 0.45 + r["all"]["h_p1"] * 0.35 + r["all"]["ou25"] * 0.20
        row = {
            "mode": mode,
            "home_adv": ha,
            "ou_bias": ou,
            "shrink": sh,
            "score": round(score, 2),
            **r,
        }
        rows.append(row)
        if best is None or row["score"] > best["score"]:
            best = row

    rows.sort(key=lambda x: -x["score"])
    print("TOP 10 composite (WDL*0.45 + H1*0.35 + OU*0.2):")
    for row in rows[:10]:
        print(json.dumps(row, ensure_ascii=False))
    print("\nBEST:")
    print(json.dumps(best, ensure_ascii=False, indent=2))
    out_path = os.path.join(A.DATA, "tune_all_best.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"best": best, "top10": rows[:10]}, f, ensure_ascii=False, indent=2)
    print("wrote", out_path)


if __name__ == "__main__":
    main()
