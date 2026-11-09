// Watches the page and reports what the chat's AI is doing:
//   idle → (user sends) → thinking → streaming → idle (answer done)
// Sites with precise signals answer through `adapter.aiPhase`; otherwise we infer the phase from the
// stop button and whether the last answer's text is growing.

import type { Adapter } from '../adapters/types';
import type { AiPhase } from '../../shared/types';

export interface ObserverEvents {
  /** The AI's phase changed. */
  phase(next: AiPhase, prev: AiPhase): void;
  /**
   * The AI started working (idle → thinking/streaming), i.e. the user just sent a message (or asked
   * for a retry). Counting user messages would misfire on virtualized lists, which add and remove
   * rows while scrolling.
   */
  sent(): void;
  /** An answer finished (busy → idle, after a short quiet period). */
  answered(): void;
}

/** How long the page must stay idle before an answer counts as finished. */
const DONE_QUIET_MS = 700;

export class AiObserver {
  private phase: AiPhase = 'idle';
  private mo: MutationObserver | null = null;
  private timer = 0;
  private poll = 0;
  private idleSince = 0;
  private lastLen = 0;
  private stopped = false;

  constructor(
    private readonly adapter: Adapter,
    private readonly doc: Document,
    private readonly on: ObserverEvents,
  ) {}

  get current(): AiPhase {
    return this.phase;
  }

  start(): void {
    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(this.doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'disabled', 'aria-busy', 'data-state'] });
    // Fallback tick: some state changes (e.g. button visibility via CSS) cause no mutation.
    this.poll = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.mo?.disconnect();
    clearTimeout(this.timer);
    clearInterval(this.poll);
  }

  /** Forget the current phase (call after switching to another chat). */
  reset(): void {
    this.lastLen = 0;
    this.idleSince = 0;
    this.phase = 'idle';
  }

  private schedule(): void {
    if (this.timer || this.stopped) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.tick();
    }, 120);
  }

  private tick(): void {
    if (this.stopped) return;
    const next = this.adapter.aiPhase(this.doc) ?? this.guess();
    if (next === 'idle') {
      if (this.phase === 'idle') return;
      // wait for a quiet moment: some sites flicker between states at the end of an answer
      const now = performance.now();
      if (!this.idleSince) this.idleSince = now;
      if (now - this.idleSince < (this.adapter.doneQuietMs ?? DONE_QUIET_MS)) {
        this.schedule();
        return;
      }
      this.idleSince = 0;
      this.set('idle');
      this.on.answered();
      return;
    }
    this.idleSince = 0;
    const wasIdle = this.phase === 'idle';
    this.set(next);
    if (wasIdle) this.on.sent();
  }

  private guess(): AiPhase {
    if (!this.adapter.isGenerating(this.doc)) return 'idle';
    const msgs = this.adapter.messages(this.doc);
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') return 'thinking';
    const len = (this.adapter.body(last).textContent ?? '').length;
    const growing = len > 0 && len !== this.lastLen;
    this.lastLen = len;
    return growing || (this.phase === 'streaming' && len > 0) ? 'streaming' : 'thinking';
  }

  private set(p: AiPhase): void {
    if (p === this.phase) return;
    const prev = this.phase;
    this.phase = p;
    this.on.phase(p, prev);
  }
}
