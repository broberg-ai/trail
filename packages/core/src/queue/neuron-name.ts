/**
 * F256 — en STI må aldrig blive til et Neuron-navn.
 *
 * MÅLT 6. september 2026, efter ejerens spørgsmål: «Jeg undrer mig over at der
 * ikke er en neuron i broberg.ai trail der hedder Christian Broberg — det tyder
 * på at der er en del link fejl pga af dette.»
 *
 * Den FINDES. Den er bare usynlig:
 *
 *   filnavn:  neurons-entities-christian-broberg-md.md
 *   titel:    /neurons/entities/christian-broberg.md     ← en STI
 *   indhold:  title: Christian Broberg + # Christian Broberg   ← korrekt
 *
 * Et kompilerings-gennemløb sendte den fulde sti som `title`, og
 * `slugify(candidate.title)` gjorde pligtskyldigt hele stien til ét filnavn.
 * Link-opløseren slår op på filnavnets slug, så `[[Christian Broberg]]` →
 * `christian-broberg` fandt aldrig `neurons-entities-christian-broberg-md`.
 *
 * SKADEN: 328 brudte links i basen, hvoraf 113 forklares af ti sådanne
 * Neuroner — 63 alene på Christian Broberg, 40 på flagskib, 10 på broberg-ai.
 *
 * Kompilerings-prompten advarer ORDRET mod netop dette. Men en regel der kun
 * står i en prompt, håndhæves af en model der er uenig med sig selv fra gang
 * til gang. Den hører hjemme i skrivevejen.
 *
 * OG DEN ER USYNLIG OVERALT HVOR ET MENNESKE KIGGER: Neuronen står på listen,
 * kan åbnes, har det rigtige indhold og den rigtige overskrift. Et brudt
 * [[link]] renderes som almindelig tekst. Der er ingen rød markering nogen
 * steder — kun link-rapporten ved det.
 */

/**
 * Ligner denne titel en FIL frem for et navn?
 *
 * TO VARIANTER, og jeg fandt kun den ene først. Målt i broberg.ai: 26 fejlfødte
 * Neuroner, 12 med skråstreg og **14 uden**:
 *
 *   /neurons/entities/christian-broberg.md    ← sti  (fanget af den første udgave)
 *   flåden-der-bygger.md                      ← BARE et filnavn (sluppet igennem)
 *
 * Den anden er lige så skadelig: slugify gør `flåden-der-bygger.md` til
 * `flåden-der-bygger-md`, og `[[Flåden der bygger]]` finder den aldrig. Havde
 * jeg kun rettet den variant jeg opdagede først, ville over halvdelen af
 * fejlkilden være blevet stående — og set rettet ud.
 *
 * En titel der ender på `.md` er altid et lækket filnavn. Ingen menneskeskrevet
 * Neuron-titel gør det; de rigtige ender på ord (`cms — broberg.ai` ender på
 * `.ai`, hvilket er en del af navnet, ikke en filendelse).
 */
export function erSti(titel: string): boolean {
  // ABSOLUT sti, ikke «indeholder en skråstreg». Min egen prøve fangede
  // forskellen: `@broberg/ai-sdk` ER et rigtigt Neuron-navn (et pakkenavn), og
  // en regel på «indeholder /» ville omdøbe det til `ai-sdk` og bryde en
  // Neuron der virker i dag. Alle 12 målte sti-tilfælde starter med `/neurons/`.
  return titel.startsWith('/') || /\.md$/i.test(titel);
}

/**
 * Træk `title:` ud af YAML-frontmatter.
 *
 * Det er IKKE et gæt: i alle ti målte tilfælde bærer indholdet den korrekte
 * titel. Kompileringen skrev det rigtige navn ned — den sendte bare det
 * forkerte med som parameter.
 */
export function frontmatterTitel(indhold: string): string | null {
  if (!indhold.startsWith('---')) return null;
  const slut = indhold.indexOf('\n---', 3);
  if (slut === -1) return null;
  for (const linje of indhold.slice(3, slut).split('\n')) {
    const m = /^title:\s*(.+?)\s*$/.exec(linje);
    if (!m) continue;
    // Titlen kan være citeret: `title: "Udgivelse som arkivering"`.
    const v = m[1]!.replace(/^["']|["']$/g, '').trim();
    return v.length > 0 ? v : null;
  }
  return null;
}

/**
 * Det navn en Neuron skal have.
 *
 * Rækkefølgen er bærende:
 *   1. er titlen IKKE en sti  → brug den. Det normale tilfælde, uændret.
 *   2. frontmatterens titel   → den kompilerede sandhed
 *   3. stiens SIDSTE led      → aldrig hele stien
 *
 * Trin 3 er en dårligere titel end trin 2, men den kan aldrig producere et
 * filnavn der bærer hele stien — og det er dét der brød linkene.
 */
export function neuronTitel(titel: string, indhold: string): string {
  if (!erSti(titel)) return titel;
  const fm = frontmatterTitel(indhold);
  if (fm && !erSti(fm)) return fm;
  const sidste = titel.split('/').filter(Boolean).pop() ?? titel;
  return sidste.replace(/\.md$/i, '') || titel;
}
