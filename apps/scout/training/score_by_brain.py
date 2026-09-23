"""F286.12 — split an eval-*.jsonl from remote_train.py per source brain.

The overall score mixes three very different sets: English Wikipedia musician
pages (one Neuron each, fixed template) and Danish/English Trail documents
(several Neurons each). A high music score can hide a low Trail score, so the
numbers that decide the next round are the per-brain ones.

Usage:  .venv/bin/python score_by_brain.py runpod-out/<run>/eval-lora.jsonl [more.jsonl ...]
"""

import json
import sys
from collections import defaultdict

from compile_metrics import neurons, norm, title_of, valid


def score(rows):
    t = defaultdict(float)
    for r in rows:
        ns = neurons(r["output"])
        out_t = {norm(x) for x in map(title_of, ns) if x}
        gold_t = {norm(x) for x in map(title_of, neurons(r["gold"])) if x}
        t["sources"] += 1
        t["neurons"] += len(ns)
        t["valid"] += sum(map(valid, ns))
        t["tp"] += len(out_t & gold_t)
        t["outTitles"] += len(out_t)
        t["goldTitles"] += len(gold_t)
        t["copying"] += r["copying"]
        t["seconds"] += r["seconds"]
    n = t["sources"]
    return {
        "sources": int(n),
        "validShare": t["valid"] / t["neurons"] if t["neurons"] else 0.0,
        "titlePrecision": t["tp"] / t["outTitles"] if t["outTitles"] else 0.0,
        "titleRecall": t["tp"] / t["goldTitles"] if t["goldTitles"] else 0.0,
        "neuronsPerSource": t["neurons"] / n if n else 0.0,
        "goldNeuronsPerSource": t["goldTitles"] / n if n else 0.0,
        "meanCopying": t["copying"] / n if n else 0.0,
        "secondsPerSource": t["seconds"] / n if n else 0.0,
    }


def main():
    for path in sys.argv[1:]:
        rows = [json.loads(line) for line in open(path)]
        groups = defaultdict(list)
        for r in rows:
            groups[r["brain"]].append(r)
        print(f"\n{path}")
        print(f"{'brain':28} {'n':>3} {'gyldig':>7} {'præc.':>6} {'dækn.':>6} {'N/kilde':>8} {'facit':>6} {'kopi':>5} {'s/kilde':>8}")
        for name, rs in sorted(groups.items()) + [("I ALT", rows)]:
            s = score(rs)
            print(f"{name:28} {s['sources']:>3} {s['validShare']:>7.0%} {s['titlePrecision']:>6.0%} "
                  f"{s['titleRecall']:>6.0%} {s['neuronsPerSource']:>8.1f} {s['goldNeuronsPerSource']:>6.1f} "
                  f"{s['meanCopying']:>5.2f} {s['secondsPerSource']:>8.0f}")


if __name__ == "__main__":
    main()
