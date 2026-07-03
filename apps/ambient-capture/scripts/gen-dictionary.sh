#!/usr/bin/env bash
# F201.14 — sync the speech dictionary from the shared npm package into a Swift
# source file. The Swift ambient app can't consume an npm package, but the
# dictionary DATA is language-agnostic JSON — so the ONE source of truth stays
# @broberg/speech-dictionary (data/corrections.json + data/terms.json), and this
# generator emits SpeechDictionaryData.swift from it. Regenerate after bumping the
# pin in packages/shared/package.json. The generated file IS committed so
# `swift build` works without a prior install.
set -euo pipefail
cd "$(dirname "$0")/.."                       # apps/ambient-capture
REPO_ROOT="$(cd ../.. && pwd)"
OUT="Sources/TrailAmbient/SpeechDictionaryData.swift"

node -e '
const path = require("path");
const fs = require("fs");
// Resolve the installed package from the shared workspace (survives pnpm store hashing).
const main = require.resolve("@broberg/speech-dictionary", { paths: [process.argv[1] + "/packages/shared"] });
const root = path.dirname(path.dirname(main));
const pkg = JSON.parse(fs.readFileSync(root + "/package.json", "utf8"));
const corrections = JSON.parse(fs.readFileSync(root + "/data/corrections.json", "utf8"));
const terms = JSON.parse(fs.readFileSync(root + "/data/terms.json", "utf8"));
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
const pairLines = corrections.map((c) => `        ("${esc(c.wrong)}", "${esc(c.right)}"),`).join("\n");
const termLines = terms.map((t) => `        "${esc(t.term)}",`).join("\n");
const out = `// GENERATED — do not edit by hand. Source: @broberg/speech-dictionary@${pkg.version}
// Regenerate: bash scripts/gen-dictionary.sh (after bumping the pin in
// packages/shared/package.json). The data is the fleet-shared ordbog; curate it
// in the components repo, never here. ${corrections.length} corrections, ${terms.length} terms.
enum SpeechDictionaryData {
    /// (wrong → right) STT corrections, verbatim from the shared package.
    static let corrections: [(String, String)] = [
${pairLines}
    ]
    /// Canonical dev/product/person names for contextualStrings biasing.
    static let terms: [String] = [
${termLines}
    ]
}
`;
fs.writeFileSync(process.argv[2], out);
console.log(`[gen-dictionary] wrote ${process.argv[2]} — ${corrections.length} corrections, ${terms.length} terms (v${pkg.version})`);
' "$REPO_ROOT" "$OUT"
