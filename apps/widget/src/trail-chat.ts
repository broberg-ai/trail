/**
 * F29 — `<trail-chat>` embeddable widget.
 *
 * Drop-in web component for embedding Trail chat on any HTML page.
 * No build step required by the host. One script tag + one custom
 * element, and you have a Trail-grounded chat panel.
 *
 * Auth model: the widget POSTs to the customer's OWN PROXY at
 * `${api}/chat` and `${api}/feedback`. The proxy holds the Trail
 * bearer token + forwards to engine.trailmem.com. This keeps the
 * token out of the browser and lets each customer apply their own
 * rate-limiting / abuse-detection / logging at their proxy layer.
 *
 * Widget itself speaks ONLY same-origin (or whatever `api`
 * resolves to) — never speaks to engine.trailmem.com directly.
 *
 * Embed example:
 *
 *   <script type="module"
 *     src="https://widget.trailmem.com/v1/trail-chat.js"></script>
 *   <trail-chat api="/api/chat-proxy" theme="auto"></trail-chat>
 *
 * Where `/api/chat-proxy` on the customer's site is a thin proxy
 * route they wrote (see docs.trailmem.com/widget/ for the
 * 30-line Next.js example).
 */
import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { marked } from 'marked';

interface Citation {
  documentId: string;
  path: string;
  filename: string;
}

interface ChatResponse {
  answer: string;
  citations?: Citation[];
  sessionId?: string;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  error?: string;
}

type FeedbackState =
  | { kind: 'idle' }
  | { kind: 'composing'; vote: 'down' | 'flag'; reason: string }
  | { kind: 'sending' }
  | { kind: 'sent'; vote: 'up' | 'down' | 'flag' }
  | { kind: 'error'; message: string };

@customElement('trail-chat')
export class TrailChat extends LitElement {
  /** Customer-proxy base URL. POSTs to `${api}/chat` + `${api}/feedback`. */
  @property({ type: String }) api = '';

  /** light / dark / auto (auto follows prefers-color-scheme). */
  @property({ type: String }) theme: 'light' | 'dark' | 'auto' = 'auto';

  /** CSS height of the widget panel. */
  @property({ type: String }) height = '600px';

  /** Placeholder text in the input field. */
  @property({ type: String }) placeholder = 'Ask anything…';

  /** Where citations render: inline (default), footnote, or off. */
  @property({ type: String, attribute: 'cite-format' })
  citeFormat: 'inline' | 'footnote' | 'off' = 'inline';

  @state() private turns: Turn[] = [];
  @state() private input = '';
  @state() private streaming = false;
  @state() private sessionId: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.api) {
      console.warn(
        '<trail-chat>: no `api` attribute set — the widget will not be able to fetch answers. Point it at your proxy endpoint, e.g. <trail-chat api="/api/chat-proxy">.',
      );
    }
    this.dispatchEvent(new CustomEvent('trail-chat:ready', { bubbles: true, composed: true }));
  }

  private get themeMode(): 'light' | 'dark' {
    if (this.theme === 'auto') {
      const prefers = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
      return prefers ? 'dark' : 'light';
    }
    return this.theme === 'dark' ? 'dark' : 'light';
  }

  private async send(): Promise<void> {
    const message = this.input.trim();
    if (!message || this.streaming || !this.api) return;

    const userTurnId = `u-${Date.now()}`;
    const assistantTurnId = `a-${Date.now()}`;
    this.turns = [
      ...this.turns,
      { id: userTurnId, role: 'user', content: message },
      { id: assistantTurnId, role: 'assistant', content: '' },
    ];
    this.input = '';
    this.streaming = true;
    this.scrollToBottom();

    try {
      const res = await fetch(`${this.api}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId: this.sessionId,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      const data = (await res.json()) as ChatResponse;
      if (data.sessionId) this.sessionId = data.sessionId;
      this.turns = this.turns.map((t) =>
        t.id === assistantTurnId
          ? { ...t, content: data.answer, citations: data.citations }
          : t,
      );
      this.dispatchEvent(
        new CustomEvent('trail-chat:answer', {
          bubbles: true,
          composed: true,
          detail: { question: message, answer: data.answer, citations: data.citations },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.turns = this.turns.map((t) =>
        t.id === assistantTurnId ? { ...t, error: message } : t,
      );
      this.dispatchEvent(
        new CustomEvent('trail-chat:error', {
          bubbles: true,
          composed: true,
          detail: { message },
        }),
      );
    } finally {
      this.streaming = false;
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const log = this.shadowRoot?.querySelector('.tc-log');
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.send();
    }
  }

  private renderAnswer(turn: Turn): TemplateResult {
    const html = marked.parse(turn.content, { async: false }) as string;
    return html as unknown as TemplateResult;
  }

  private renderCitations(turn: Turn): TemplateResult | typeof nothing {
    if (!turn.citations?.length || this.citeFormat === 'off') return nothing;
    return html`
      <div class="tc-citations">
        <span class="tc-citations-label">Kilder:</span>
        ${turn.citations.map(
          (c) => html`
            <span class="tc-citation" title=${c.path}>
              ${c.filename.replace(/\.md$/, '')}
            </span>
          `,
        )}
      </div>
    `;
  }

  render(): TemplateResult {
    const themeAttr = this.themeMode;
    return html`
      <div class="tc-root" data-theme=${themeAttr} style="height: ${this.height}">
        <div class="tc-log">
          ${this.turns.length === 0
            ? html`<div class="tc-empty">${this.placeholder}</div>`
            : this.turns.map((turn) => this.renderTurn(turn))}
        </div>
        <div class="tc-input-row">
          <textarea
            class="tc-input"
            .value=${this.input}
            @input=${(e: InputEvent) => {
              this.input = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${this.handleKeydown}
            placeholder=${this.placeholder}
            rows="2"
            ?disabled=${this.streaming || !this.api}
          ></textarea>
          <button
            class="tc-send"
            @click=${() => void this.send()}
            ?disabled=${this.streaming || !this.input.trim() || !this.api}
            aria-label="Send"
          >
            ${this.streaming ? '…' : '↑'}
          </button>
        </div>
      </div>
    `;
  }

  private renderTurn(turn: Turn): TemplateResult {
    if (turn.role === 'user') {
      return html`
        <div class="tc-turn tc-turn-user">
          <div class="tc-bubble">${turn.content}</div>
        </div>
      `;
    }
    if (turn.error) {
      return html`
        <div class="tc-turn tc-turn-assistant">
          <div class="tc-bubble tc-bubble-error">⚠ ${turn.error}</div>
        </div>
      `;
    }
    if (!turn.content) {
      return html`
        <div class="tc-turn tc-turn-assistant">
          <div class="tc-bubble tc-thinking">
            <span class="tc-dot"></span>
            <span class="tc-dot"></span>
            <span class="tc-dot"></span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="tc-turn tc-turn-assistant">
        <div class="tc-bubble">
          <div .innerHTML=${this.renderAnswer(turn)}></div>
        </div>
        ${this.renderCitations(turn)}
        <trail-feedback
          .turn=${turn}
          .api=${this.api}
        ></trail-feedback>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
    }

    .tc-root {
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      border: 1px solid var(--tc-border, rgba(0, 0, 0, 0.1));
      background: var(--tc-bg, #faf9f5);
      color: var(--tc-fg, #1a1715);
      overflow: hidden;
    }
    .tc-root[data-theme='dark'] {
      --tc-bg: #17140f;
      --tc-fg: #f5f1ea;
      --tc-border: rgba(245, 241, 234, 0.1);
      --tc-bubble-bg: #1f1b16;
      --tc-bubble-user-bg: rgba(232, 168, 124, 0.15);
      --tc-fg-muted: rgba(245, 241, 234, 0.7);
      --tc-fg-subtle: rgba(245, 241, 234, 0.4);
      --tc-accent: #e8a87c;
    }
    .tc-root[data-theme='light'] {
      --tc-bg: #faf9f5;
      --tc-fg: #1a1715;
      --tc-border: rgba(26, 23, 21, 0.1);
      --tc-bubble-bg: #ffffff;
      --tc-bubble-user-bg: rgba(232, 168, 124, 0.12);
      --tc-fg-muted: rgba(26, 23, 21, 0.7);
      --tc-fg-subtle: rgba(26, 23, 21, 0.4);
      --tc-accent: #c97a1a;
    }

    .tc-log {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .tc-empty {
      color: var(--tc-fg-subtle);
      text-align: center;
      padding: 2rem 1rem;
      font-style: italic;
    }

    .tc-turn {
      display: flex;
      flex-direction: column;
      max-width: 90%;
    }
    .tc-turn-user {
      align-self: flex-end;
      align-items: flex-end;
    }
    .tc-turn-assistant {
      align-self: flex-start;
    }

    .tc-bubble {
      background: var(--tc-bubble-bg);
      border: 1px solid var(--tc-border);
      border-radius: 10px;
      padding: 0.65rem 0.9rem;
      word-break: break-word;
    }
    .tc-turn-user .tc-bubble {
      background: var(--tc-bubble-user-bg);
    }
    .tc-bubble-error {
      border-color: rgba(220, 50, 50, 0.4);
      color: rgb(220, 80, 80);
    }
    .tc-bubble :first-child {
      margin-top: 0;
    }
    .tc-bubble :last-child {
      margin-bottom: 0;
    }
    .tc-bubble p {
      margin: 0.4em 0;
    }
    .tc-bubble pre {
      background: rgba(0, 0, 0, 0.06);
      padding: 0.6rem 0.85rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.88em;
    }
    .tc-bubble code {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 0.9em;
    }
    .tc-bubble :not(pre) > code {
      background: rgba(0, 0, 0, 0.06);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    .tc-bubble a {
      color: var(--tc-accent);
    }

    .tc-thinking {
      display: inline-flex;
      gap: 4px;
      padding: 0.75rem 1rem;
    }
    .tc-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tc-fg-subtle);
      animation: tc-pulse 1.4s ease-in-out infinite;
    }
    .tc-dot:nth-child(2) {
      animation-delay: 0.2s;
    }
    .tc-dot:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes tc-pulse {
      0%,
      80%,
      100% {
        opacity: 0.3;
        transform: scale(0.8);
      }
      40% {
        opacity: 1;
        transform: scale(1);
      }
    }

    .tc-citations {
      margin-top: 0.4rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: center;
    }
    .tc-citations-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tc-fg-subtle);
    }
    .tc-citation {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 11px;
      padding: 0.1rem 0.4rem;
      border: 1px solid var(--tc-border);
      border-radius: 4px;
      color: var(--tc-fg-muted);
    }

    .tc-input-row {
      display: flex;
      gap: 0.5rem;
      padding: 0.75rem;
      border-top: 1px solid var(--tc-border);
      background: var(--tc-bg);
    }
    .tc-input {
      flex: 1;
      resize: none;
      border: 1px solid var(--tc-border);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      background: var(--tc-bubble-bg);
      color: var(--tc-fg);
      font: inherit;
    }
    .tc-input:focus {
      outline: 2px solid var(--tc-accent);
      outline-offset: -1px;
    }
    .tc-send {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      border: none;
      background: var(--tc-accent);
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      align-self: flex-end;
    }
    .tc-send:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;
}

// ─── <trail-feedback> sub-component ────────────────────────────────

@customElement('trail-feedback')
export class TrailFeedback extends LitElement {
  @property({ type: Object }) turn: Turn | null = null;
  @property({ type: String }) api = '';
  @state() private state: FeedbackState = { kind: 'idle' };

  private async send(vote: 'up' | 'down' | 'flag', reason?: string): Promise<void> {
    if (!this.turn || !this.api) return;
    this.state = { kind: 'sending' };
    try {
      const res = await fetch(`${this.api}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vote,
          turnId: this.turn.id,
          answer: this.turn.content,
          citations: this.turn.citations,
          reason,
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.state = { kind: 'sent', vote };
    } catch (err) {
      this.state = {
        kind: 'error',
        message: err instanceof Error ? err.message : 'failed',
      };
    }
  }

  render(): TemplateResult {
    if (this.state.kind === 'sent') {
      const emoji = this.state.vote === 'up' ? '👍' : this.state.vote === 'down' ? '👎' : '🚩';
      return html`<div class="tf-sent">${emoji} Tak — feedback sendt.</div>`;
    }
    if (this.state.kind === 'composing') {
      return html`
        <div class="tf-composing">
          <textarea
            class="tf-reason"
            .value=${this.state.reason}
            @input=${(e: InputEvent) =>
              (this.state = { ...this.state as Extract<FeedbackState, { kind: 'composing' }>, reason: (e.target as HTMLTextAreaElement).value })}
            placeholder="Hvad var galt med svaret?"
            rows="2"
          ></textarea>
          <div class="tf-row">
            <button @click=${() => (this.state = { kind: 'idle' })}>Annullér</button>
            <button
              class="tf-submit"
              ?disabled=${!(this.state.kind === 'composing' && this.state.reason.trim())}
              @click=${() => {
                if (this.state.kind === 'composing') {
                  const { vote, reason } = this.state;
                  void this.send(vote, reason.trim());
                }
              }}
            >
              Send feedback
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="tf-bar">
        <button title="Godt svar" @click=${() => void this.send('up')}>👍</button>
        <button
          title="Dårligt svar"
          @click=${() => (this.state = { kind: 'composing', vote: 'down', reason: '' })}
        >
          👎
        </button>
        <button
          title="Flag for curator"
          @click=${() => (this.state = { kind: 'composing', vote: 'flag', reason: '' })}
        >
          🚩
        </button>
        ${this.state.kind === 'error'
          ? html`<span class="tf-err">${this.state.message}</span>`
          : nothing}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      margin-top: 0.4rem;
    }
    .tf-bar {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
    .tf-bar button {
      background: transparent;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      padding: 0.15rem 0.45rem;
      cursor: pointer;
      font-size: 13px;
    }
    .tf-bar button:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    .tf-err {
      font-size: 11px;
      color: rgb(220, 80, 80);
      margin-left: 0.25rem;
    }
    .tf-composing {
      margin-top: 0.4rem;
      padding: 0.5rem;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.02);
    }
    .tf-reason {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      padding: 0.3rem 0.5rem;
      font: inherit;
      font-size: 13px;
    }
    .tf-row {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.4rem;
    }
    .tf-row button {
      padding: 0.25rem 0.65rem;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
    }
    .tf-submit {
      background: #c97a1a !important;
      color: #fff;
      border-color: #c97a1a !important;
    }
    .tf-submit:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .tf-sent {
      font-size: 11px;
      color: rgb(46, 125, 50);
      margin-top: 0.25rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'trail-chat': TrailChat;
    'trail-feedback': TrailFeedback;
  }
}
