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
}): string {
  const { doc, sidebar } = opts;
  const title = `${doc.title} — Trail Docs`;
  const audienceMeta = `<meta name="audience" content="${doc.audience}" />`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(doc.summary)}" />
  ${audienceMeta}
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-header">
    <a href="/" class="brand">
      <span class="brand-mark">▲</span>
      <span class="brand-text">Trail <span class="brand-sub">Docs</span></span>
    </a>
    <nav class="site-nav" aria-label="Top">
      <a href="/why-not-rag/">Why not RAG?</a>
      <a href="/quick-start/">Quick start</a>
      <a href="https://github.com/broberg-ai/trail" rel="external">GitHub</a>
      <a href="https://trailmem.com/" rel="external">trailmem.com</a>
    </nav>
  </header>
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
    const html = renderPage({ doc, sidebar });
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
