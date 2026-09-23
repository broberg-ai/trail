"""F286.11 — measure a compile model on the golden sources it never trained on.

  eval_compile.py <name> [--adapter <path>] [--limit N]

Runs the model (with or without a LoRA adapter) on every row of
data/compile-golden.jsonl, writes each output to data/compile-eval-<name>.jsonl
so it can be READ against its source afterwards, and prints three numbers:

  valid     share of Neurons with YAML frontmatter carrying a title AND at
            least one markdown heading — the shape Trail's write path expects
  titles    precision/recall of output titles against the golden Neuron titles,
            compared case- and accent-insensitively
  copying   share of the output's 8-word sequences found verbatim in the
            source. A model that pastes the source scores high on titles and
            valid markdown and has compiled nothing — this is the number that
            catches it (F286 plan §16: text similarity alone rewards copying).

Temperature 0 and a fixed cap on output length, so two runs are comparable.
"""

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

ROOT = Path(__file__).resolve().parent.parent
BASE = "mlx-community/Qwen3.5-4B-MLX-4bit"
SEP = "<<<NEURON>>>"
FRONTMATTER = re.compile(r"^\s*---\s*\n(.*?)\n---\s*\n", re.S)


def norm(t):
    t = unicodedata.normalize("NFKD", t.lower())
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


def neurons(text):
    return [p.strip() for p in text.split(SEP) if p.strip()]


def title_of(neuron):
    m = FRONTMATTER.match(neuron)
    if not m:
        return None
    t = re.search(r"^title:\s*(.+)$", m.group(1), re.M)
    return t.group(1).strip().strip("\"'") if t else None


def valid(neuron):
    return title_of(neuron) is not None and re.search(r"^#{1,3} \S", neuron, re.M) is not None


def copying(output, source):
    words = lambda s: re.findall(r"\w+", s.lower())
    src = words(source)
    grams = {tuple(src[i:i + 8]) for i in range(len(src) - 7)}
    out = words(output)
    mine = [tuple(out[i:i + 8]) for i in range(len(out) - 7)]
    return sum(g in grams for g in mine) / len(mine) if mine else 0.0


def main():
    name = sys.argv[1]
    adapter = sys.argv[sys.argv.index("--adapter") + 1] if "--adapter" in sys.argv else None
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    rows = [json.loads(l) for l in open(ROOT / "data" / "compile-golden.jsonl")][:limit]
    model, tok = load(BASE, adapter_path=adapter)
    sampler = make_sampler(temp=0.0)
    out_path = ROOT / "data" / f"compile-eval-{name}.jsonl"
    totals = {"neurons": 0, "valid": 0, "tp": 0, "outTitles": 0, "goldTitles": 0, "copying": 0.0}
    with open(out_path, "w") as f:
        for i, r in enumerate(rows):
            messages = r["messages"][:2]
            gold = r["messages"][2]["content"]
            prompt = tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False,
                                             enable_thinking=False)
            max_tokens = min(4096, int(len(tok.encode(gold)) * 1.5) + 256)
            t0 = time.time()
            output = generate(model, tok, prompt=prompt, max_tokens=max_tokens, sampler=sampler)
            ns = neurons(output)
            out_titles = {norm(t) for t in map(title_of, ns) if t}
            gold_titles = {norm(t) for t in map(title_of, neurons(gold)) if t}
            cp = copying(output, messages[1]["content"])
            totals["neurons"] += len(ns)
            totals["valid"] += sum(map(valid, ns))
            totals["tp"] += len(out_titles & gold_titles)
            totals["outTitles"] += len(out_titles)
            totals["goldTitles"] += len(gold_titles)
            totals["copying"] += cp
            f.write(json.dumps({"sourceId": r["sourceId"], "brain": r["brain"], "output": output,
                                "gold": gold, "seconds": round(time.time() - t0),
                                "copying": round(cp, 3)}, ensure_ascii=False) + "\n")
            f.flush()
            print(f"[{name}] {i + 1}/{len(rows)} {r['brain']} neurons={len(ns)} "
                  f"titles={len(out_titles & gold_titles)}/{len(gold_titles)} copy={cp:.2f} "
                  f"({time.time() - t0:.0f}s)", flush=True)
    n = len(rows)
    report = {
        "name": name, "adapter": adapter, "sources": n,
        "neurons": totals["neurons"],
        "validShare": totals["valid"] / totals["neurons"] if totals["neurons"] else 0.0,
        "titlePrecision": totals["tp"] / totals["outTitles"] if totals["outTitles"] else 0.0,
        "titleRecall": totals["tp"] / totals["goldTitles"] if totals["goldTitles"] else 0.0,
        "meanCopying": totals["copying"] / n if n else 0.0,
    }
    (ROOT / "data" / f"compile-eval-{name}.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
