"""F286.11/F286.12 — the compile metrics, shared by the M1 eval (eval_compile.py)
and the GPU run (remote_train.py), so both machines are scored by the SAME rules.
Pure Python on purpose: it must import on a pod without MLX."""

import re
import unicodedata

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
