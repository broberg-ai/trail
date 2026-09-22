"""Ask Scout a question — the tool to test the trained classifier by hand.

  predict.py <task> "<text>"          one answer: label + confidence, or «ingen passer»
  predict.py <task> --bench [N]       CPU time per document over N golden texts (F286.4 AC#1)

Runs on CPU on purpose: F286.5 serves the classifier from cb-ubuntu, which has
no GPU, so a latency measured on the M1's GPU would be a number for a machine the
model will not run on. The abstain threshold is the one train.py fitted on the
validation slice and wrote into models/<task>/result.json.
"""

import json
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
MAX_LEN = 256


def load(task):
    path = ROOT / "models" / task
    result = json.loads((path / "result.json").read_text())
    tok = AutoTokenizer.from_pretrained(path)
    model = AutoModelForSequenceClassification.from_pretrained(path).eval()
    return tok, model, result["labels"], result["golden"]["threshold"]


@torch.no_grad()
def answer(tok, model, labels, threshold, text):
    enc = tok(text, truncation=True, max_length=MAX_LEN, return_tensors="pt")
    probs = torch.softmax(model(**enc).logits[0].float(), -1)
    conf, idx = probs.max(0)
    label = labels[int(idx)] if float(conf) >= threshold else None
    return label, float(conf), labels[int(idx)]


def main():
    torch.set_num_threads(4)
    task = sys.argv[1]
    tok, model, labels, threshold = load(task)
    if sys.argv[2] == "--bench":
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        texts = [r["text"] for r in map(json.loads, open(ROOT / "data" / "golden.jsonl")) if r["task"] == task][:n]
        answer(tok, model, labels, threshold, texts[0])  # warm-up, not timed
        times = []
        for t in texts:
            t0 = time.perf_counter()
            answer(tok, model, labels, threshold, t)
            times.append((time.perf_counter() - t0) * 1000)
        times.sort()
        print(json.dumps({"task": task, "device": "cpu", "threads": 4, "docs": len(times),
                          "medianMs": round(times[len(times) // 2], 1),
                          "p90Ms": round(times[int(len(times) * 0.9)], 1),
                          "maxMs": round(times[-1], 1)}))
        return
    label, conf, top = answer(tok, model, labels, threshold, sys.argv[2])
    if label is None:
        print(f"ingen passer (bedste gæt {top}, sikkerhed {conf:.2f} < tærskel {threshold:.2f})")
    else:
        print(f"{label}  (sikkerhed {conf:.2f})")


if __name__ == "__main__":
    main()
