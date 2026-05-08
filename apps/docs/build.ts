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
  const sorted = [...items].sort((a, b) => a.order - b.order);
  // Phase 1: flat list. Phase 2 will group by category here.
  const links = sorted
    .map((item) => {
      const href = item.slug === "index" ? "/" : `/${item.slug}/`;
      const active = item.slug === currentSlug ? ' class="active"' : "";
      return `<li><a href="${href}"${active}>${escapeHtml(item.title)}</a></li>`;
    })
    .join("\n      ");
  return `<nav class="sidebar" aria-label="Documentation navigation">
    <ul>
      ${links}
    </ul>
  </nav>`;
}

// ── Page template ──────────────────────────────────────────

function renderPage(opts: {
  doc: Doc;
  sidebar: string;
  topLinks: SidebarItem[];
}): string {
  const { doc, sidebar, topLinks } = opts;
  // Title pattern matches admin's "Trail · Admin": "{Page} — trail · docs"
  // — the en-dash + lowercase site identifier are landing's typography.
  const title = doc.slug === "index"
    ? "trail · docs"
    : `${doc.title} — trail · docs`;
  const audienceMeta = `<meta name="audience" content="${doc.audience}" />`;
  // Build top-nav links from the same content tree the sidebar uses,
  // skipping the home doc (since "trail" wordmark is already a link to /).
  const topNavLinks = topLinks
    .filter((item) => item.slug !== "index")
    .sort((a, b) => a.order - b.order)
    .map((item) => `<a href="/${item.slug}/">${escapeHtml(item.title)}</a>`)
    .join("\n      ");

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
      <a href="https://trailmem.com/" class="nav-signin">trailmem.com</a>
      <a href="https://github.com/broberg-ai/trail" class="nav-cta" rel="external">GitHub</a>
      <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>
  <div id="mobile-menu" class="nav-mobile" role="navigation" aria-label="Mobile menu" aria-hidden="true">
    ${topNavLinks}
    <a href="https://trailmem.com/">trailmem.com</a>
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
  lines.push("- API: docs.trailmem.com/api-reference (Phase 3, coming soon)");
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

  console.log(`[trail-docs] built ${docs.length} pages`);
}

build().catch((err) => {
  console.error("[trail-docs] build failed:", err);
  process.exit(1);
});
