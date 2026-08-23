# F207 — No credential reaches git

**Status:** in progress · found 2026-08-22, acted on 2026-08-23 · **critical**

## What happened

A real, full-access Trail API key was written directly into the web-clipper
extension's source and committed:

```
apps/web-clipper/src/background/main.ts:5   token: 'trail_95d866…'
apps/web-clipper/src/popup/Popup.tsx:19     const DEFAULT_TOKEN = 'trail_95d866…'

git log -S <key>  →  c251935  (22 April 2026)
gh repo view      →  visibility: PUBLIC
```

So it was a **published credential for four months**, in a public repository.

Measured blast radius: the key authenticated (HTTP 200) against the local dev
engine on `127.0.0.1:58031` and was refused (401) by the cloud. That local
engine holds Christian's real CB-M1 knowledge base, and — per **F205.1** — every
`trail_` key minted so far is unrestricted: read every Neuron, change settings,
delete sources, mint more keys.

Removing it from `HEAD` does not remove it from history. Rotation is the only
remedy; the cleanup is cosmetic without it.

## The part worth sitting with

**The detector that would have caught this has been in this repo the whole
time.** `@broberg/secret-scan` (re-exported by `@trail/shared`) carries a
`trail_[A-Za-z0-9]{20,}` pattern, and F197 wired it into the ingest path.

But F197 pointed it at *what enters Trail's knowledge base* — never at *what
enters git*. The tool was right, the placement was wrong, and a boundary nobody
had named stayed unguarded for four months.

That is the same failure family this repo keeps meeting: not a missing check,
but a check that cannot see the thing it is trusted to catch. So the fix is not
a new detector — it is the existing one, at the boundary that was missing.

## What was done

**F207.1 — rotate.**
Minted a replacement, stored it in the cardmem vault, revoked the leaked key,
and verified by *making a real request with the dead key and getting 401* — not
by trusting the revoke call's 200. The extension now ships **no token at all**:
install seeds only the server URL, and the popup's default is empty. With no
token the UI already says "Not configured", so an empty default degrades
honestly instead of failing with an opaque 401.

**F207.2 — gate.**
A scanner over git-tracked files, built on the shared detector, running in two
places:

- a **pre-commit hook** committed to the repo (`core.hooksPath`), so the secret
  is refused before it ever becomes a commit;
- the **CI gate** (F206.2), so a machine without the hook installed still
  cannot land one.

Two deliberate design choices:

1. **No hand-rolled regexes.** Patterns stay curated in the fleet-owned
   package. A local copy would drift from it, and drift in a security pattern
   list is worse than no list — it reads as coverage.
2. **Opt-out is per LINE, with an inline marker — never a path glob.** There
   are legitimate synthetic secrets in tests (`packages/ambient-gate/src/candidate.test.ts`
   carries an Anthropic-shaped fake on purpose). A path allowlist would start
   as one entry and quietly grow until the gate covers nothing; a per-line
   marker stays visible and greppable, and every exemption is one line someone
   deliberately wrote.

## Verification

A gate that has never refused anything is not known to work. So the AC requires
planting a real-shaped key, confirming **both** the commit is refused and the
scan exits non-zero, and only then removing it.

## Non-goals

- Rewriting git history to purge the key. The repo is public and the key is
  rotated; a history rewrite would break every clone for a credential that is
  already dead. Rotation is the remedy, not erasure.
- Entropy-based detection. The shared package deliberately refuses bare
  high-entropy matching (it would hit git shas), and that judgement stays with
  the package owner.
- Scanning for secrets in *other* repos. If this gate is worth having here it is
  worth having fleet-wide — but that is a message to `components`, not a change
  in this repo.

## Follow-up owed to the fleet

The same shape almost certainly exists elsewhere: the detector is published, and
every repo that has it is probably also using it only at the ingest boundary.
Tell `components` so the placement — commit-time + CI — travels with the
package, rather than each repo rediscovering it after its own leak.

## Breakdown

- **F207.1** — Rotate the leaked key and take it out of the source
- **F207.2** — Secret gate: block a credential at commit time and in CI
