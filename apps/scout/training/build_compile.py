"""F286.10 — build the compile model's dataset from exported source→Neuron pairs.

Reads data/pairs-broberg-ai-<brain>.json (export-dataset.ts --export --with-content)
and data/titles-<brain>.json (every active Neuron title in the brain), writes
data/compile-train.jsonl and data/compile-golden.jsonl in mlx-lm chat format.

What it does to the target text, and why:
  · {#claim-…} anchors are REMOVED. The server inserts them on write
    (prepareCompiledMarkdown); a model that learned to emit them would be
    inventing ids.
  · Trail's own Neurons get æ/ø/å back (restore_danish.py). The SAME function
    rewrites titles and [[link]] targets, so a link and the title it points at
    stay identical. A link to a title the brain does not have is unwrapped to
    plain text (counted in the report); a dead link left after that fails the build.
  · Music keeps only Neurons under /neurons/sources/ — entity pages are
    deterministic templates (Forager, 22/9).
Golden: ≥15 % of sources per brain, chosen by a hash of the source id so the
split is stable across rebuilds, and marked in the row itself.

Usage: build_compile.py measure   (lengths + counts, writes nothing)
       build_compile.py build <max_tokens>
"""

import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

from transformers import AutoTokenizer

import restore_danish as R

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BRAINS = {"scout-training-0001-v2": True, "scout-training-0002": True, "music": False}  # True = restore æøå
TOKENIZER = "Qwen/Qwen3.5-4B"
GOLDEN_FRACTION = 0.15
SEPARATOR = "\n\n<<<NEURON>>>\n\n"
SYSTEM = ("You compile a source document into Trail Neurons: markdown pages with YAML "
          "frontmatter (title, type, tags, sources) and [[wiki-links]] between them. "
          "Write in the source's language unless the brain's convention says otherwise. "
          f"Separate Neurons with a line containing only <<<NEURON>>>.")
ANCHOR = re.compile(r"\s*\{#claim-[0-9a-f]+\}")
LINK = re.compile(r"\[\[([^\]|]+)(\|[^\]]*)?\]\]")
UNWRAPPED = Counter()
EXTRA = json.loads((Path(__file__).parent / "danish-compounds.json").read_text())


def fix(text, restore):
    if not restore:
        return text
    return R.fix_text(text, EXTRA, Counter())


def fix_links(text, restore):
    if not restore:
        return text
    return LINK.sub(lambda m: "[[" + R.fix_text(m.group(1), EXTRA, Counter()) + (m.group(2) or "") + "]]", text)


def rows():
    for brain, restore in BRAINS.items():
        pairs = json.loads((DATA / f"pairs-broberg-ai-{brain}.json").read_text())
        titles = {fix(t, restore) for t in json.loads((DATA / f"titles-{brain}.json").read_text())}
        for p in pairs:
            neurons = [n for n in p["neurons"] if restore or (n.get("path") or "").startswith("/neurons/sources/")]
            if not neurons or not p.get("sourceText"):
                continue
            targets = []
            for n in neurons:
                body = fix_links(fix(ANCHOR.sub("", n.get("content") or ""), restore), restore)
                # A link to a page the brain does not have teaches the model to
                # invent pages. 40 such links were in the COMPILED data before
                # any rewrite (measured 23/9: identical count with and without
                # restore_danish), so they are unwrapped to their text here.
                UNWRAPPED[brain] += sum(1 for m in LINK.finditer(body) if m.group(1).strip() not in titles)
                body = LINK.sub(lambda m: m.group(0) if m.group(1).strip() in titles
                                else (m.group(2) or "|" + m.group(1))[1:], body)
                targets.append(body)
            yield {"brain": brain, "sourceId": p["sourceId"], "source": p["sourceText"],
                   "target": SEPARATOR.join(targets), "neurons": len(targets), "titles": titles}


def is_golden(source_id, brain_ids):
    rank = sorted(brain_ids, key=lambda i: hashlib.sha256(i.encode()).hexdigest())
    return source_id in set(rank[: math.ceil(len(rank) * GOLDEN_FRACTION)])


def main():
    mode = sys.argv[1]
    tok = AutoTokenizer.from_pretrained(TOKENIZER)
    data = list(rows())
    for r in data:
        r["tokens"] = len(tok(SYSTEM + r["source"] + r["target"])["input_ids"])
    dead = Counter()
    for r in data:
        for m in LINK.finditer(r["target"]):
            if m.group(1).strip() not in r["titles"]:
                dead[(r["brain"], m.group(1).strip())] += 1
    by_brain = Counter(r["brain"] for r in data)
    lengths = sorted(r["tokens"] for r in data)
    pct = lambda q: lengths[min(len(lengths) - 1, int(len(lengths) * q))]
    report = {"pairs": dict(by_brain), "total": len(data),
              "tokens": {"p50": pct(0.5), "p75": pct(0.75), "p90": pct(0.9), "p95": pct(0.95), "max": lengths[-1]},
              "deadLinks": sum(dead.values()), "unwrappedDeadLinks": dict(UNWRAPPED), "deadLinkExamples": [f"{b}: {t}" for (b, t), _ in dead.most_common(15)]}
    if mode == "measure":
        for cap in (2048, 4096, 8192):
            report[f"within{cap}"] = sum(1 for x in lengths if x <= cap)
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return
    cap = int(sys.argv[2])
    # Split AFTER the cap: splitting first let the cap remove golden rows and
    # left 14.5 % (measured 23/9), under the 15 % the card asks for.
    ids = {b: [r["sourceId"] for r in data if r["brain"] == b and r["tokens"] <= cap] for b in by_brain}
    out = {"train": [], "golden": []}
    dropped = Counter()
    for r in data:
        if r["tokens"] > cap:
            dropped[r["brain"]] += 1
            continue
        split = "golden" if is_golden(r["sourceId"], ids[r["brain"]]) else "train"
        out[split].append({"split": split, "brain": r["brain"], "sourceId": r["sourceId"], "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": r["source"]},
            {"role": "assistant", "content": r["target"]}]})
    for split, items in out.items():
        with open(DATA / f"compile-{split}.jsonl", "w") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
    both = {i["sourceId"] for i in out["train"]} & {i["sourceId"] for i in out["golden"]}
    report.update({"cap": cap, "droppedOverCap": dict(dropped),
                   "train": dict(Counter(i["brain"] for i in out["train"])),
                   "golden": dict(Counter(i["brain"] for i in out["golden"])), "overlap": len(both)})
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if both or dead:
        sys.exit(1)


if __name__ == "__main__":
    main()
