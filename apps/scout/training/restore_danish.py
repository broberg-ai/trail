"""Restore æ/ø/å in Neurons the local compile wrote as ASCII ("paa", "koe", "foer").

Measured 22/9 2026: scout-training-0001-v2 has 0 of 173 Neuron titles with
æ/ø/å, and 8 of 9 hand-read Neurons (F286.9 AC#6) spell Danish that way in the
prose while their quotes are correct. A compile model trained on them learns to
write "paa". The classifier does not read these brains, so this is compile-data
hygiene, not a blocker for F286.4.

HOW A TOKEN IS DECIDED — a Danish frequency list, never a blind replace:
  every variant of the token with oe→ø, aa→å, ae→æ (each occurrence either way)
  is scored with wordfreq's Danish zipf frequency. The ASCII original wins ties
  and anything within MARGIN, so "Aalborg" (5.26 vs "Ålborg" 3.72) and English
  words ("does": no Danish variant exists) stay as they are.
Tokens no variant of which is a known word (mostly compounds such as
"Kurateringskoeen") are NOT guessed: they are reported, so a human-readable list
decides them rather than a rule nobody checked.

Usage:
  restore_danish.py measure <dump.jsonl>      # dry run: counts + unresolved list
  restore_danish.py plan <dump.jsonl> <map.json> > edits.jsonl
dump.jsonl rows: {"id", "title", "content"}; map.json: extra {"ascii": "unicode"}.
"""

import itertools
import json
import re
import sys
from collections import Counter

from wordfreq import zipf_frequency

MARGIN = 0.5
PAIRS = {"oe": "ø", "aa": "å", "ae": "æ", "Oe": "Ø", "Aa": "Å", "Ae": "Æ", "OE": "Ø", "AA": "Å", "AE": "Æ"}
# Words the frequency list gets wrong, each found by reading its context (22/9):
# "kommandoer" is correct Danish (plural of kommando), not "kommandør"; "koen" is
# "i koen" = "i køen"; "saas"/"SAAS" is the product term, and "sås" a real word.
FIXED = {"kommandoer": "kommandoer", "Kommandoer": "Kommandoer", "koen": "køen",
         "saas": "saas", "SAAS": "SAAS", "aa": "aa", "ae": "ae", "AA": "AA", "AE": "AE"}
SUSPECT = re.compile(r"[A-Za-z]*(?:oe|aa|ae|Oe|Aa|Ae|OE|AA|AE)[A-Za-z]*")
# Claim anchors, wiki-links' targets, code and URLs are identifiers, not prose.
PROTECTED = re.compile(r"\{#claim-[0-9a-f]+\}|`[^`]*`|https?://\S+|\[\[[^\]|]*|\S*/\S*|[\w.-]+\.md\b")


def variants(token):
    spans = [(m.start(), m.group()) for m in re.finditer("|".join(PAIRS), token)]
    for choice in itertools.product([False, True], repeat=len(spans)):
        if not any(choice):
            continue
        out, pos = [], 0
        for (start, pair), swap in zip(spans, choice):
            out.append(token[pos:start])
            out.append(PAIRS[pair] if swap else pair)
            pos = start + 2
        out.append(token[pos:])
        yield "".join(out)


def decide(token, extra):
    if token in extra:
        return extra[token]
    if token in FIXED:
        return FIXED[token]
    # Mixed case past the first letter is a name or an acronym, never Danish
    # prose: "SaaS" became "SåS" in the first dry run.
    if not token.isupper() and any(ch.isupper() for ch in token[1:]):
        return token
    base = zipf_frequency(token.lower(), "da")
    best, best_f = None, 0.0
    for v in variants(token):
        f = zipf_frequency(v.lower(), "da")
        if f > best_f:
            best, best_f = v, f
    if best is not None and best_f > base + MARGIN:
        return best
    if best_f == 0.0 and base == 0.0 and zipf_frequency(token.lower(), "en") == 0.0:
        return None  # unknown in both directions: report, do not guess
    return token


def fix_text(text, extra, unresolved):
    protected = [(m.start(), m.end()) for m in PROTECTED.finditer(text)]

    def repl(m):
        if any(a <= m.start() < b for a, b in protected):
            return m.group()
        d = decide(m.group(), extra)
        if d is None:
            unresolved[m.group()] += 1
            return m.group()
        return d

    return SUSPECT.sub(repl, text)


def main():
    mode, dump = sys.argv[1], sys.argv[2]
    extra = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
    rows = [json.loads(l) for l in open(dump)]
    unresolved, changed_docs, changed_tokens = Counter(), 0, 0
    for r in rows:
        new = fix_text(r["content"], extra, unresolved)
        diff = sum(a != b for a, b in zip(re.findall(r"\S+", r["content"]), re.findall(r"\S+", new)))
        if new != r["content"]:
            changed_docs += 1
            changed_tokens += diff
            if mode == "plan":
                print(json.dumps({"id": r["id"], "title": r["title"], "old": r["content"], "new": new}, ensure_ascii=False))
    if mode == "measure":
        print(json.dumps({"docs": len(rows), "docsChanged": changed_docs, "tokensChanged": changed_tokens,
                          "unresolvedDistinct": len(unresolved),
                          "unresolved": unresolved.most_common()}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
