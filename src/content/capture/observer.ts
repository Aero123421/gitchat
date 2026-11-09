// Watches the page and reports what the chat's AI is doing:
//   idle → (user sends) → thinking → streaming → idle (answer done)
// Sites with precise signals answer through `adapter.aiPhase`; otherwise we infer the phase from the
// stop button and whether the last answer's text is growing.
//
// "Done" is only declared after the page has stayed idle *and* the transcript has stopped changing
// for the adapter's quiet period (sites flicker between states near the end of a turn). A busy turn
// that a virtualized list unmounted is not "done". A turn that makes no progress for a long time is
// "stalled": the widget stops showing "thinking", but the operation stays outstanding — nothing
// treats it as finished, and a late completion still reports its answer.

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
  /** The running turn stalled (no progress for a long time), or came back to life. */
  stalled?(on: boolean): void;
}

export interface ObserverOptions {
  /** A busy phase without any change in the transcript for this long counts as stalled. */
  stallMs?: number;
  /** Once the site says "idle", declare the answer done after at most this long, even if the page keeps changing. */
  maxSettleMs?: number;
}

/** How long the page must stay idle before an answer counts as finished. */
const DONE_QUIET_MS = 700;
const STALL_MS = 10 * 60_000;
const MAX_SETTLE_MS = 20_000;
const WATCHED = ['data-is-streaming', 'disabled', 'aria-busy', 'data-state'];

export class AiObserver {
  private phase: AiPhase = 'idle';
  private mo: MutationObserver | null = null;
  private timer = 0;
  private poll = 0;
  private idleSince = 0;
  private lastLen = 0;
  private stopped = false;
  /** Last change inside the transcript (not elsewhere on the page). */
  private lastChange = 0;
  /** Turn the AI was last seen working on (see Adapter.activeTurnId). */
  private latched: string | null = null;
  /** Set when a busy phase stalled; busy signals are ignored until the transcript changes again. */
  private stalledAt = 0;
  /** A turn started and has not reported its answer yet (also while stalled). */
  private outstanding = false;
  /** Counts turns: +1 each time the AI starts working (each "sent"). */
  private turns = 0;
  private readonly stallMs: number;
  private readonly maxSettleMs: number;

  constructor(
    private readonly adapter: Adapter,
    private readonly doc: Document,
    private readonly on: ObserverEvents,
    opts: ObserverOptions = {},
  ) {
    this.stallMs = opts.stallMs ?? STALL_MS;
    this.maxSettleMs = opts.maxSettleMs ?? MAX_SETTLE_MS;
  }

  /** What the widget shows (a stalled turn shows as idle). */
  get current(): AiPhase {
    return this.phase;
  }

  /** True only when no turn is in progress — a stalled turn is not finished. */
  get settled(): boolean {
    return !this.outstanding;
  }

  get stalled(): boolean {
    return this.stalledAt > 0;
  }

  /** Identity of the current/last turn: changes whenever the AI starts working again. */
  get turn(): number {
    return this.turns;
  }

  start(): void {
    this.lastChange = performance.now();
    this.mo = new MutationObserver((records) => this.onMutations(records));
    this.mo.observe(this.doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...new Set([...WATCHED, ...(this.adapter.watchAttributes ?? [])])],
    });
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
    this.latched = null;
    this.stalledAt = 0;
    this.outstanding = false;
    this.turns++;
    this.lastChange = performance.now();
    this.phase = 'idle';
  }

  private root: { el: HTMLElement | null; at: number } = { el: null, at: -Infinity };

  private onMutations(records: MutationRecord[]): void {
    const now = performance.now();
    // the transcript element, looked up at most once a second (the lookup can force a layout)
    if (now - this.root.at > 1000 || !this.root.el?.isConnected) this.root = { el: this.adapter.scrollContainer(this.doc), at: now };
    const root = this.root.el;
    if (!root || records.some((r) => root.contains(r.target))) this.lastChange = now;
    this.schedule();
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
    const now = performance.now();
    const next = this.adapter.aiPhase(this.doc) ?? this.guess();

    if (next !== 'idle') {
      if (this.stalledAt) {
        // stalled: ignore busy signals until the transcript moves again; then resume (no new "sent")
        if (this.lastChange <= this.stalledAt) return;
        this.stalledAt = 0;
        this.on.stalled?.(false);
        this.set(next);
        return;
      }
      this.idleSince = 0;
      this.latched = this.adapter.activeTurnId?.(this.doc) ?? this.latched;
      const wasIdle = !this.outstanding;
      this.set(next);
      if (wasIdle) {
        this.outstanding = true;
        this.turns++;
        this.lastChange = now;
        this.on.sent();
        return;
      }
      this.checkStall(now);
      return;
    }

    if (!this.outstanding) return;
    // the busy turn was unmounted by a virtualized list: it is not done, just out of sight
    if (this.latched && this.adapter.hasTurn && !this.adapter.hasTurn(this.doc, this.latched)) {
      this.idleSince = 0;
      this.checkStall(now);
      return;
    }
    // wait for a quiet moment: some sites flicker between states at the end of an answer, and the
    // answer text may still be settling
    if (!this.idleSince) this.idleSince = now;
    const quietFor = now - Math.max(this.idleSince, this.lastChange);
    if (quietFor < (this.adapter.doneQuietMs ?? DONE_QUIET_MS) && now - this.idleSince < this.maxSettleMs) {
      this.schedule();
      return;
    }
    // done — also when it had stalled before: a late completion still counts
    this.idleSince = 0;
    this.latched = null;
    this.outstanding = false;
    if (this.stalledAt) {
      this.stalledAt = 0;
      this.on.stalled?.(false);
    }
    this.set('idle');
    this.on.answered();
  }

  /** No progress in the transcript for a long time: stop showing "thinking", keep the turn open. */
  private checkStall(now: number): void {
    if (!this.outstanding || this.stalledAt || now - this.lastChange < this.stallMs) return;
    this.stalledAt = now;
    this.set('idle');
    this.on.stalled?.(true);
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
