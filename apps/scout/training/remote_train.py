"""F286.12 — runs ON the Runpod pod: LoRA-train Qwen3.5-4B, then score it.

Copied to the pod together with compile_metrics.py and the data by
runpod_train.py; never run locally. Writes everything to /root/out/ so the
orchestrator can fetch one folder home.

THE SAME TRAINING AS M1 (F286.11), mirrored from mlx-lm's defaults so the two
runs can be put side by side: LoRA rank 8, scale 20 (PEFT alpha = 160), on the
LAST 8 of the 32 layers, all linear modules there, learning rate 1e-5, batch 1,
3 epochs, loss on the assistant turn only (--mask-prompt), seed 42, 8.192-token
cap already applied when the data was built. What differs is the arithmetic:
bf16 on a GPU instead of a 4-bit model on MLX — stated in the report, because
it is the one thing «the same training» cannot mean.

Then: greedy generation on all 47 golden sources WITH the adapter and on the first
15 WITHOUT it,
scored by compile_metrics (the same functions eval_compile.py uses on M1).
"""

import json
import os
import random
import re
import sys
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

from compile_metrics import copying, neurons, norm, title_of, valid

BASE = os.environ.get("SCOUT_BASE", "Qwen/Qwen3.5-4B")
# /root on the pod; overridable so the masking can be tested on the Mac first.
POD_ROOT = Path(os.environ.get("SCOUT_POD_ROOT", "/root"))
DATA = POD_ROOT / "data"
OUT = POD_ROOT / "out"
SEED, EPOCHS, LR, LAST_LAYERS, RANK, SCALE = 42, 3, 1e-5, 8, 8, 20.0
OUT.mkdir(parents=True, exist_ok=True)
log = open(OUT / "log.txt", "a")


def say(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    log.write(line + "\n")
    log.flush()


def encode(tok, messages):
    """Token ids + labels with the prompt masked (-100), like --mask-prompt."""
    prompt = tok.apply_chat_template(messages[:2], add_generation_prompt=True, tokenize=False,
                                     enable_thinking=False)
    full = tok.apply_chat_template(messages, tokenize=False, enable_thinking=False)
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    ids = tok(full, add_special_tokens=False)["input_ids"]
    labels = [-100] * len(p_ids) + ids[len(p_ids):]
    return torch.tensor([ids]), torch.tensor([labels])


def train(model, tok):
    rows = [json.loads(l) for l in open(DATA / "train.jsonl")]
    layers = model.config.num_hidden_layers
    # PEFT refuses "all-linear" together with layers_to_transform (run 4, 23/9), so name every
    # Linear in the last LAST_LAYERS decoder layers explicitly. `.layers.N.` skips a vision tower.
    keep = set(range(layers - LAST_LAYERS, layers))
    targets = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear)
               and (hit := re.search(r"\.layers\.(\d+)\.", n)) and int(hit.group(1)) in keep]
    if not targets:
        raise RuntimeError("no Linear modules found in the last layers — module naming changed")
    cfg = LoraConfig(r=RANK, lora_alpha=RANK * SCALE, lora_dropout=0.0, target_modules=targets,
                     task_type="CAUSAL_LM")
    model = get_peft_model(model, cfg)
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    say(f"train rows {len(rows)} · trainable params {trainable:,} · layers {layers - LAST_LAYERS}-{layers - 1}")
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
    rng = random.Random(SEED)
    model.train()
    step, t0 = 0, time.time()
    for epoch in range(EPOCHS):
        order = list(range(len(rows)))
        rng.shuffle(order)
        total = 0.0
        for i in order:
            ids, labels = encode(tok, rows[i]["messages"])
            loss = model(input_ids=ids.cuda(), labels=labels.cuda()).loss
            loss.backward()
            opt.step()
            opt.zero_grad()
            total += loss.item()
            step += 1
            if step % 25 == 0:
                say(f"epoch {epoch + 1} step {step}/{EPOCHS * len(rows)} loss {total / 25:.4f} "
                    f"({time.time() - t0:.0f}s, peak {torch.cuda.max_memory_allocated() / 1e9:.1f} GB)")
                total = 0.0
    model.save_pretrained(OUT / "adapter")
    return model, time.time() - t0


@torch.no_grad()
def evaluate(model, tok, name, limit=None):
    model.eval()
    rows = [json.loads(l) for l in open(DATA / "golden.jsonl")][:limit]
    totals = {"neurons": 0, "valid": 0, "tp": 0, "outTitles": 0, "goldTitles": 0, "copying": 0.0}
    t0 = time.time()
    with open(OUT / f"eval-{name}.jsonl", "w") as f:
        for r in rows:
            messages, gold = r["messages"][:2], r["messages"][2]["content"]
            prompt = tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False,
                                             enable_thinking=False)
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False).to("cuda")
            max_new = min(4096, int(len(tok.encode(gold)) * 1.5) + 256)
            s = time.time()
            out = model.generate(**ids, max_new_tokens=max_new, do_sample=False)
            output = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
            ns = neurons(output)
            out_t = {norm(t) for t in map(title_of, ns) if t}
            gold_t = {norm(t) for t in map(title_of, neurons(gold)) if t}
            cp = copying(output, messages[1]["content"])
            totals["neurons"] += len(ns); totals["valid"] += sum(map(valid, ns))
            totals["tp"] += len(out_t & gold_t); totals["outTitles"] += len(out_t)
            totals["goldTitles"] += len(gold_t); totals["copying"] += cp
            f.write(json.dumps({"sourceId": r["sourceId"], "brain": r["brain"], "output": output, "gold": gold,
                                "seconds": round(time.time() - s), "copying": round(cp, 3)}, ensure_ascii=False) + "\n")
    n = len(rows)
    report = {"name": name, "sources": n, "neurons": totals["neurons"],
              "validShare": totals["valid"] / totals["neurons"] if totals["neurons"] else 0.0,
              "titlePrecision": totals["tp"] / totals["outTitles"] if totals["outTitles"] else 0.0,
              "titleRecall": totals["tp"] / totals["goldTitles"] if totals["goldTitles"] else 0.0,
              "meanCopying": totals["copying"] / n if n else 0.0, "seconds": round(time.time() - t0)}
    say(f"eval {name}: {json.dumps(report)}")
    return report


def main():
    torch.manual_seed(SEED)
    random.seed(SEED)
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16, device_map="cuda")
    say(f"loaded {type(model).__name__} in {time.time() - t0:.0f}s on {torch.cuda.get_device_name()}")
    model, train_seconds = train(model, tok)
    with_adapter = evaluate(model, tok, "lora")
    with model.disable_adapter():
        # 15, not 47: the untrained model is the comparison, and 47 more greedy
        # generations would add ~45 min of rented GPU for a number we only need roughly.
        base = evaluate(model, tok, "base", limit=15)
    (OUT / "result.json").write_text(json.dumps({
        "base": BASE, "gpu": torch.cuda.get_device_name(), "dtype": "bfloat16",
        "config": {"seed": SEED, "epochs": EPOCHS, "lr": LR, "rank": RANK, "scale": SCALE,
                   "lastLayers": LAST_LAYERS, "batch": 1, "maskPrompt": True},
        "trainSeconds": round(train_seconds), "peakMemoryGb": round(torch.cuda.max_memory_allocated() / 1e9, 1),
        "lora": with_adapter, "baseModel": base, "totalSeconds": round(time.time() - t0),
    }, indent=2))
    say("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the orchestrator reads this marker; the pod is deleted either way
        say(f"FAILED {type(e).__name__}: {e}")
        raise
    sys.exit(0)
