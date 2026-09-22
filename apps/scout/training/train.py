"""F286.4 — train Scout's classifier: one mmBERT-base head per task, on M1 (MPS).

Reads data/train.jsonl, never data/golden.jsonl (verify-split.ts proves the two
are disjoint; this script only opens golden AFTER training, to measure).

Per task:
  1. Cap each label at MAX_PER_LABEL training rows. routing is 70 % buddy-sessions
     and admit is 70 % approved; uncapped, the model learns the majority and the
     golden set (which is balanced per label) punishes it.
  2. Hold out VAL_FRACTION of those rows, stratified, as a validation slice. The
     abstain threshold is fitted HERE, on training data — fitting it on golden
     would make the golden number a number we tuned towards.
  3. Fine-tune with frozen token embeddings. mmBERT's 256k-token vocabulary is
     ~2/3 of its parameters; freezing it cuts the optimizer state by the same
     share, which is what makes a 300M encoder fit comfortably in 16 GB.
  4. Keep ONE copy of the weights per task (models/<task>/). No checkpoint series.

Then measure on golden: accuracy when always answering, and with the threshold —
where a prediction below it counts as an abstention ("ingen passer"), reported
apart from wrong answers.

Usage:  training/.venv/bin/python training/train.py [task ...]
"""

import json
import random
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MODELS = ROOT / "models"
BASE = "jhu-clsp/mmBERT-base"
SEED = 42
MAX_PER_LABEL = 800
VAL_FRACTION = 0.1
MAX_LEN = 256
BATCH = 8
# Two micro-batches of 8 per optimizer step = the same effective batch of 16 the
# first two tasks ran with. Measured 22/9: batch 16 on routing's longer texts
# pushed the process to 6.6 GB and the 16 GB Mac into swap — zero steps in 10 min.
ACCUM = 2
EPOCHS = 3
LR = 3e-5
TASKS = ["source-type", "routing", "neuron-type", "edge-type", "admit", "candidate-kind"]

device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def seed_all():
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)


def load(path, task):
    return [r for r in map(json.loads, open(path)) if r["task"] == task]


def cap_and_split(rows):
    by_label = defaultdict(list)
    for r in rows:
        by_label[r["label"]].append(r)
    rng = random.Random(SEED)
    train, val = [], []
    for label in sorted(by_label):
        items = sorted(by_label[label], key=lambda r: r["id"])
        rng.shuffle(items)
        items = items[:MAX_PER_LABEL]
        # A label with 1-2 rows goes entirely to training: a val slice of zero
        # or one row cannot fit a threshold, and the model needs every example.
        n_val = int(len(items) * VAL_FRACTION) if len(items) >= 10 else 0
        val += items[:n_val]
        train += items[n_val:]
    rng.shuffle(train)
    return train, val


def batches(rows, tok, labels, shuffle, rng):
    idx = list(range(len(rows)))
    if shuffle:
        rng.shuffle(idx)
    for i in range(0, len(idx), BATCH):
        chunk = [rows[j] for j in idx[i : i + BATCH]]
        enc = tok([r["text"] for r in chunk], truncation=True, max_length=MAX_LEN,
                  padding=True, return_tensors="pt")
        y = torch.tensor([labels.index(r["label"]) if r["label"] in labels else -1 for r in chunk])
        yield {k: v.to(device) for k, v in enc.items()}, y.to(device)


@torch.no_grad()
def predict(model, tok, rows, labels):
    model.eval()
    probs = []
    for x, _ in batches(rows, tok, labels, False, None):
        probs.append(torch.softmax(model(**x).logits.float(), -1).cpu())
    return torch.cat(probs).numpy() if probs else np.zeros((0, len(labels)))


def fit_threshold(probs, gold, labels):
    """The confidence below which Scout says «ingen passer».

    Chosen to maximise correct − wrong on the validation slice: an abstention
    costs nothing, a wrong answer costs one. That is the trade the owner asked
    for — a model that can decline rather than guess inside the menu (F286.8).
    """
    conf = probs.max(1)
    pred = probs.argmax(1)
    truth = np.array([labels.index(g) for g in gold])
    best_t, best_score = 0.0, -1e9
    for t in np.arange(0.0, 1.0, 0.02):
        answered = conf >= t
        right = int(((pred == truth) & answered).sum())
        wrong = int(((pred != truth) & answered).sum())
        if right - wrong > best_score:
            best_t, best_score = float(t), right - wrong
    return best_t


def score(probs, rows, labels, threshold):
    pred = [labels[i] for i in probs.argmax(1)]
    conf = probs.max(1)
    out = {"examples": len(rows)}
    out["accuracyAlwaysAnswer"] = sum(p == r["label"] for p, r in zip(pred, rows)) / max(len(rows), 1)
    right = sum(p == r["label"] and c >= threshold for p, r, c in zip(pred, rows, conf))
    wrong = sum(p != r["label"] and c >= threshold for p, r, c in zip(pred, rows, conf))
    out.update({"threshold": threshold, "right": right, "wrong": wrong,
                "abstained": len(rows) - right - wrong,
                "accuracyWithAbstain": right / max(len(rows), 1)})
    by = []
    for label in sorted({r["label"] for r in rows} | set(pred)):
        support = sum(r["label"] == label for r in rows)
        predicted = sum(p == label for p in pred)
        tp = sum(p == label and r["label"] == label for p, r in zip(pred, rows))
        by.append({"label": label, "support": support, "predicted": predicted, "truePositives": tp,
                   "precision": tp / predicted if predicted else None,
                   "recall": tp / support if support else None})
    out["byLabel"] = by
    return out


def run(task):
    seed_all()
    t0 = time.time()
    rows = load(DATA / "train.jsonl", task)
    golden = load(DATA / "golden.jsonl", task)
    golden_ids = {r["id"] for r in golden}
    leak = [r["id"] for r in rows if r["id"] in golden_ids]
    if leak:
        raise SystemExit(f"{task}: {len(leak)} golden ids in training data — refusing to train")

    train, val = cap_and_split(rows)
    labels = sorted({r["label"] for r in train})
    print(f"[{task}] train {len(train)} · val {len(val)} · golden {len(golden)} · labels {len(labels)} "
          f"{dict(Counter(r['label'] for r in train))}", flush=True)

    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE, num_labels=len(labels), id2label=dict(enumerate(labels)),
        label2id={l: i for i, l in enumerate(labels)}).to(device)
    for p in model.get_input_embeddings().parameters():
        p.requires_grad = False
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR, weight_decay=0.01)
    steps = EPOCHS * ((len(train) + BATCH * ACCUM - 1) // (BATCH * ACCUM))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / (0.06 * steps)) * max(0.0, (steps - s) / steps))

    rng = random.Random(SEED)
    step = 0
    for epoch in range(EPOCHS):
        model.train()
        total = 0.0
        micro = 0
        for x, y in batches(train, tok, labels, True, rng):
            loss = torch.nn.functional.cross_entropy(model(**x).logits.float(), y)
            (loss / ACCUM).backward()
            total += loss.item() / ACCUM
            micro += 1
            if micro % ACCUM:
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad()
            step += 1
            if step % 50 == 0:
                print(f"[{task}] epoch {epoch + 1} step {step}/{steps} loss {total / 50:.4f} "
                      f"({time.time() - t0:.0f}s)", flush=True)
                total = 0.0

    val_probs = predict(model, tok, val, labels)
    threshold = fit_threshold(val_probs, [r["label"] for r in val], labels) if val else 0.0
    result = {"task": task, "base": BASE, "seed": SEED, "maxPerLabel": MAX_PER_LABEL, "epochs": EPOCHS,
              "trainRows": len(train), "valRows": len(val), "labels": labels,
              "val": score(val_probs, val, labels, threshold) if val else None,
              "golden": score(predict(model, tok, golden, labels), golden, labels, threshold),
              "seconds": round(time.time() - t0)}
    if task == "edge-type":
        non_cites = [r for r in golden if r["label"] != "cites"]
        result["goldenWithoutCites"] = score(predict(model, tok, non_cites, labels), non_cites, labels, threshold)

    out = MODELS / task
    if out.exists():
        shutil.rmtree(out)
    model.save_pretrained(out)
    tok.save_pretrained(out)
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=lambda o: o.item()))
    g = result["golden"]
    print(f"[{task}] DONE golden always-answer {g['accuracyAlwaysAnswer']:.3f} · with abstain "
          f"{g['right']} right / {g['wrong']} wrong / {g['abstained']} abstained (t={threshold:.2f}) "
          f"· {result['seconds']}s", flush=True)
    del model, opt
    torch.mps.empty_cache()


if __name__ == "__main__":
    for task in sys.argv[1:] or TASKS:
        run(task)
