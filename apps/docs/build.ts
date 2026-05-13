/**
 * trail-docs — static site generator for docs.trailmem.com (F185).
 *
 * Reads markdown from content/docs/*.md (frontmatter via gray-matter,
 * body via marked, code blocks via shiki) and writes static HTML to
 * deploy/. Mirrors apps/landing/build.ts's tsx + nginx pattern.
 *
 * Phase 1 surface: home (/) + intro + why-not-rag + quick-start.
 * Phase 2 adds category-grouped sidebar; Phase 3 adds /api-reference
 * + openapi-trail.yaml asset; Phase 5 adds llms.txt + Pagefind index.
 *
 * Run:  pnpm build         (outputs to deploy/)
 *       npm run build      (CI uses npm — landing precedent)
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { marked } from "marked";
import matter from "gray-matter";
import { createHighlighter, type Highlighter } from "shiki";
import { z } from "zod";

const OUT_DIR = process.env.BUILD_OUT_DIR ?? "dist";
const CONTENT_DIR = join(import.meta.dirname, "content");
const PUBLIC_DIR = join(import.meta.dirname, "public");
const DOCS_DIR = join(CONTENT_DIR, "docs");

// ── Frontmatter schema ─────────────────────────────────────

const FrontmatterSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  summary: z.string().min(1).max(280),
  order: z.number().int().nonnegative(),
  category: z.string().optional(),
  /**
   * Optional audience hint — surfaces in the page <head> as a meta tag
   * so AI agents WebFetching the page see "this doc is for you".
   * Phase 1 leaves this empty by default; the why-not-rag page sets
   * "ai-agent" so planning AIs know to read it first.
   */
  audience: z.enum(["human", "ai-agent", "both"]).default("both"),
});

interface DocFrontmatter extends z.infer<typeof FrontmatterSchema> {}

interface Doc extends DocFrontmatter {
  body: string; // rendered HTML
}

// ── Markdown rendering ─────────────────────────────────────

let highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ["github-dark"],
      langs: [...SHIKI_LANGS],
    });
  }
  return highlighter;
}

// Languages we register up-front. Keep this list small — every extra
// grammar adds ~5-15kb to the highlighter footprint. Anything outside
// this list falls back to plain "text" (no highlight, just preformatted).
const SHIKI_LANGS = ["typescript", "javascript", "json", "bash", "yaml", "http", "markdown"] as const;

let markedConfigured = false;

async function renderMarkdown(md: string): Promise<string> {
  const hl = await getHighlighter();

  // Configure marked once. The renderer.code override replaces the
  // default <pre><code>...</code></pre> wrapper entirely with shiki's
  // own <pre class="shiki">...</pre>. Using walkTokens + escaped=true
  // double-wraps and escapes the shiki HTML, which is the bug we hit
  // on the first build.
  if (!markedConfigured) {
    marked.use({
      renderer: {
        code({ text, lang }) {
          const requested = (lang ?? "").trim();
          const safeLang = (SHIKI_LANGS as readonly string[]).includes(requested)
            ? requested
            : "text";
          return hl.codeToHtml(text, { lang: safeLang, theme: "github-dark" });
        },
      },
    });
    markedConfigured = true;
  }

  return marked.parse(md) as string;
}

// ── Sidebar ────────────────────────────────────────────────

interface SidebarItem {
  title: string;
  slug: string;
  category?: string;
  order: number;
}

function renderSidebar(items: SidebarItem[], currentSlug: string): string {
  // F185 Phase 2: group by `category` frontmatter field. Items without
  // a category render at the top under no header (kept for the index
  // page that links to everything). Groups are ordered by the lowest
  // `order` value within each — so curators can place a section first
  // by giving its members low order numbers, without needing a
  // separate category-order config.
  const groups = new Map<string, SidebarItem[]>();
  const ungrouped: SidebarItem[] = [];
  for (const item of items) {
    if (item.category) {
      const arr = groups.get(item.category) ?? [];
      arr.push(item);
      groups.set(item.category, arr);
    } else {
      ungrouped.push(item);
    }
  }

  const renderLink = (item: SidebarItem): string => {
    const href = item.slug === "index" ? "/" : `/${item.slug}/`;
    const active = item.slug === currentSlug ? ' class="active"' : "";
    return `<li><a href="${href}"${active}>${escapeHtml(item.title)}</a></li>`;
  };

  // Order groups by min `order` of their members.
  const groupEntries: Array<{ name: string; minOrder: number; items: SidebarItem[] }> = [];
  for (const [name, arr] of groups.entries()) {
    const sorted = [...arr].sort((a, b) => a.order - b.order);
    const minOrder = sorted.length > 0 && sorted[0] ? sorted[0].order : Infinity;
    groupEntries.push({ name, minOrder, items: sorted });
  }
  groupEntries.sort((a, b) => a.minOrder - b.minOrder);

  const sections: string[] = [];

  if (ungrouped.length > 0) {
    const links = ungrouped
      .sort((a, b) => a.order - b.order)
      .map(renderLink)
      .join("\n        ");
    sections.push(`<ul class="sidebar-section">\n        ${links}\n      </ul>`);
  }

  for (const group of groupEntries) {
    const links = group.items.map(renderLink).join("\n        ");
    sections.push(
      `<div class="sidebar-group">\n        <h3 class="sidebar-heading">${escapeHtml(group.name)}</h3>\n        <ul>\n          ${links}\n        </ul>\n      </div>`,
    );
  }

  return `<nav class="sidebar" aria-label="Documentation navigation">
      ${sections.join("\n      ")}
    </nav>`;
}

// ── Page template ──────────────────────────────────────────

function renderPage(opts: {
  doc: Doc;
  sidebar: string;
  topLinks: SidebarItem[];
}): string {
  const { doc, sidebar } = opts;
  // Title pattern matches admin's "Trail · Admin": "{Page} — trail · docs"
  // — the en-dash + lowercase site identifier are landing's typography.
  const title = doc.slug === "index"
    ? "trail · docs"
    : `${doc.title} — trail · docs`;
  const audienceMeta = `<meta name="audience" content="${doc.audience}" />`;

  // Top nav is HIGH-LEVEL navigation, NOT a duplicate of the sidebar.
  // docs.webhouse.app pattern: Docs | API | Changelog. The full
  // documentation tree lives in the sidebar; the top-nav just gives
  // quick links to the broadest sections + external surfaces.
  const topNavLinks = [
    `<a href="/intro/">Docs</a>`,
    `<a href="/api-reference/">API</a>`,
    `<a href="https://github.com/broberg-ai/trail/releases" rel="external">Changelog</a>`,
  ].join("\n      ");

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(doc.summary)}" />
  ${audienceMeta}
  <meta name="theme-color" content="#FAF9F5" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/memx-logo.svg" />
  <link rel="stylesheet" href="/styles.css" />
  <script>
    (function(){try{var t=localStorage.getItem('trail.theme');document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
  </script>
</head>
<body>
  <canvas id="trail-graph" aria-hidden="true"></canvas>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="40" height="40" role="img" aria-label="trail">
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="16" cy="16" r="9" fill="none" stroke="#e8a87c" stroke-width="0.9" opacity="0.55"/>
        <circle cx="16" cy="16" r="3.5" fill="#e8a87c"/>
      </svg>
      <span class="brand-text">trail</span>
      <span class="brand-section">docs</span>
    </a>
    <div class="nav-links">
      ${topNavLinks}
    </div>
    <div class="nav-actions">
      <button type="button" class="theme-toggle" aria-label="Toggle theme">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      </button>
      <a href="https://github.com/broberg-ai/trail" class="nav-icon" rel="external" aria-label="GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
      </a>
      <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>
  <div id="mobile-menu" class="nav-mobile" role="navigation" aria-label="Mobile menu" aria-hidden="true">
    ${topNavLinks}
    <a href="https://github.com/broberg-ai/trail">GitHub</a>
  </div>
  <div class="layout">
    ${sidebar}
    <main class="content">
      <article>
        <header class="doc-header">
          <h1>${escapeHtml(doc.title)}</h1>
          <p class="doc-summary">${escapeHtml(doc.summary)}</p>
        </header>
        <div class="doc-body">
          ${doc.body}
        </div>
      </article>
      <footer class="doc-footer">
        <p>
          Trail is open source on <a href="https://github.com/broberg-ai/trail">GitHub</a>
          (FSL-1.1-Apache-2.0). Found a docs bug? Edit
          <a href="https://github.com/broberg-ai/trail/blob/main/apps/docs/content/docs/${doc.slug}.md">this page on GitHub</a>.
        </p>
      </footer>
    </main>
  </div>
  <script>
    (function () {
      var btn = document.querySelector('.nav-toggle');
      var menu = document.getElementById('mobile-menu');
      var body = document.body;
      if (!btn || !menu) return;
      function setOpen(open) {
        body.dataset.menuOpen = open ? 'true' : 'false';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      btn.addEventListener('click', function () { setOpen(body.dataset.menuOpen !== 'true'); });
      menu.addEventListener('click', function (e) {
        if (e.target instanceof HTMLAnchorElement) setOpen(false);
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    })();

    (function () {
      var tbtn = document.querySelector('.theme-toggle');
      if (!tbtn) return;
      tbtn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('trail.theme', next); } catch (e) {}
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', next === 'dark' ? '#17140F' : '#FAF9F5');
      });
    })();
  </script>
  <script>
/* Neuron-particle background — LIFTED VERBATIM from apps/landing.
   Reads --graph-* CSS variables for color tokens, re-caches on theme
   change via MutationObserver. Pauses on tab-hidden +
   prefers-reduced-motion. */
(function(){
  const canvas = document.getElementById('trail-graph');
  if (!canvas) return;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ctx = canvas.getContext('2d');
  let animationFrameId = 0;
  let running = false;
  let particles = [];
  const mouse = { x: null, y: null };
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const colors = { node: '#1a1715', accent: '#e8a87c', line: '26, 23, 21', accentLine: '232, 168, 124' };
  function refreshColors(){
    const cs = getComputedStyle(document.documentElement);
    const read = function(n, f){ return (cs.getPropertyValue(n).trim() || f); };
    colors.node = read('--graph-node', colors.node);
    colors.accent = read('--graph-accent', colors.accent);
    colors.line = read('--graph-line', colors.line);
    colors.accentLine = read('--graph-accent-line', colors.accentLine);
  }
  refreshColors();

  if ('MutationObserver' in window) {
    new MutationObserver(refreshColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function resize(){
    canvas.width = window.innerWidth * DPR;
    canvas.height = window.innerHeight * DPR;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initParticles();
  }

  function Particle(){
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * window.innerHeight;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = (Math.random() - 0.5) * 0.3;
    this.baseRadius = Math.random() > 0.95 ? 3 : 1.5;
    this.isAccent = Math.random() > 0.98;
  }
  Particle.prototype.update = function(){
    this.x += this.vx;
    this.y += this.vy;
    if ((this.x < 0 && this.vx < 0) || (this.x > window.innerWidth && this.vx > 0)) this.vx = -this.vx;
    if ((this.y < 0 && this.vy < 0) || (this.y > window.innerHeight && this.vy > 0)) this.vy = -this.vy;
    if (mouse.x !== null && mouse.y !== null) {
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < 100) { this.x -= dx * 0.01; this.y -= dy * 0.01; }
    }
  };
  Particle.prototype.draw = function(){
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.baseRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.isAccent ? colors.accent : colors.node;
    ctx.fill();
  };

  function initParticles(){
    particles = [];
    const count = Math.min(150, Math.floor((window.innerWidth * window.innerHeight) / 15000));
    for (let i = 0; i < count; i++) particles.push(new Particle());
  }

  const LINK_DIST = 160;
  const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
  function drawLines(){
    for (let i = 0; i < particles.length; i++){
      const pi = particles[i];
      for (let j = i + 1; j < particles.length; j++){
        const pj = particles[j];
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const d2 = dx*dx + dy*dy;
        if (d2 >= LINK_DIST_SQ) continue;
        const opacity = 1 - (Math.sqrt(d2) / LINK_DIST);
        ctx.beginPath();
        if (pi.isAccent || pj.isAccent) {
          ctx.strokeStyle = 'rgba(' + colors.accentLine + ', ' + (opacity * 0.5) + ')';
        } else {
          ctx.strokeStyle = 'rgba(' + colors.line + ', ' + (opacity * 0.18) + ')';
        }
        ctx.lineWidth = 0.6;
        ctx.moveTo(pi.x, pi.y);
        ctx.lineTo(pj.x, pj.y);
        ctx.stroke();
      }
    }
  }

  function renderOneFrame(){
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of particles){ p.update(); p.draw(); }
    drawLines();
  }

  function loop(){
    if (!running) return;
    renderOneFrame();
    animationFrameId = requestAnimationFrame(loop);
  }
  function start(){
    if (running || reduceMotion) return;
    running = true;
    loop();
  }
  function stop(){
    running = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', function(e){ mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseout', function(){ mouse.x = null; mouse.y = null; });
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) stop();
    else start();
  });

  resize();
  if (reduceMotion) {
    renderOneFrame();
  } else {
    start();
  }
})();
  </script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── llms.txt ───────────────────────────────────────────────

function renderLlmsTxt(items: SidebarItem[], summaries: Map<string, string>): string {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const lines: string[] = [
    "# Trail",
    "",
    "Trail is an AI-native knowledge engine — a compile-at-ingest second brain.",
    "Unlike RAG systems that chunk + embed + retrieve, Trail compiles raw sources",
    "into curated Neurons (atoms of knowledge) at ingest time. External apps",
    "integrate by POSTing candidates to the queue and reading committed Neurons.",
    "",
    "Read /why-not-rag/ first if you are an AI agent designing a memory layer.",
    "",
    "## Documentation",
    "",
  ];
  for (const item of sorted) {
    const url =
      item.slug === "index"
        ? "https://docs.trailmem.com/"
        : `https://docs.trailmem.com/${item.slug}/`;
    const summary = summaries.get(item.slug) ?? "";
    lines.push(`- [${item.title}](${url}): ${summary}`);
  }
  lines.push("");
  lines.push("## Source");
  lines.push("");
  lines.push("- Repository: https://github.com/broberg-ai/trail");
  lines.push("- License: FSL-1.1-Apache-2.0");
  lines.push("- Interactive API reference: https://docs.trailmem.com/api-reference/");
  lines.push("- Raw OpenAPI 3.1 YAML: https://docs.trailmem.com/openapi-trail.yaml");
  lines.push("");
  return lines.join("\n");
}

// ── Build ──────────────────────────────────────────────────

async function build(): Promise<void> {
  console.log(`[trail-docs] building → ${OUT_DIR}/`);

  if (!existsSync(DOCS_DIR)) {
    throw new Error(`content/docs/ does not exist: ${DOCS_DIR}`);
  }

  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    throw new Error(`No .md files found in ${DOCS_DIR}`);
  }

  // 1. Parse + validate all docs
  const docs: Doc[] = [];
  for (const file of files) {
    const raw = readFileSync(join(DOCS_DIR, file), "utf-8");
    const parsed = matter(raw);
    const frontmatter = FrontmatterSchema.parse(parsed.data);
    const body = await renderMarkdown(parsed.content);
    docs.push({ ...frontmatter, body });
  }

  // 2. Build sidebar shape
  const sidebarItems: SidebarItem[] = docs.map((d) => ({
    title: d.title,
    slug: d.slug,
    category: d.category,
    order: d.order,
  }));

  // 3. Render each doc
  mkdirSync(OUT_DIR, { recursive: true });
  for (const doc of docs) {
    const sidebar = renderSidebar(sidebarItems, doc.slug);
    const html = renderPage({ doc, sidebar, topLinks: sidebarItems });
    const outFile =
      doc.slug === "index"
        ? join(OUT_DIR, "index.html")
        : join(OUT_DIR, doc.slug, "index.html");
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, html, "utf-8");
    console.log(`  → ${doc.slug === "index" ? "/" : `/${doc.slug}/`}`);
  }

  // 4. llms.txt
  const summaries = new Map(docs.map((d) => [d.slug, d.summary]));
  const llmsTxt = renderLlmsTxt(sidebarItems, summaries);
  writeFileSync(join(OUT_DIR, "llms.txt"), llmsTxt, "utf-8");
  console.log("  → /llms.txt");

  // 5. Copy public/ assets
  if (existsSync(PUBLIC_DIR)) {
    cpSync(PUBLIC_DIR, OUT_DIR, { recursive: true });
    console.log(`  → public/* copied`);
  }

  // 6. Mirror packages/shared/openapi.yaml → deploy/openapi-trail.yaml
  // so the /api-reference/ page's Redoc can fetch it from the same
  // origin. Single source of truth: the YAML in packages/shared/.
  const OPENAPI_SRC = join(import.meta.dirname, "..", "..", "packages", "shared", "openapi.yaml");
  if (existsSync(OPENAPI_SRC)) {
    const yaml = readFileSync(OPENAPI_SRC, "utf-8");
    writeFileSync(join(OUT_DIR, "openapi-trail.yaml"), yaml, "utf-8");
    console.log(`  → /openapi-trail.yaml (synced from packages/shared/openapi.yaml)`);
  } else {
    console.warn(`[trail-docs] WARNING: packages/shared/openapi.yaml not found — /api-reference/ Redoc will 404`);
  }

  console.log(`[trail-docs] built ${docs.length} pages`);
}

build().catch((err) => {
  console.error("[trail-docs] build failed:", err);
  process.exit(1);
});
