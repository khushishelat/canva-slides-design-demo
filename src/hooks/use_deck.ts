/**
 * Deck orchestration UI state, fed by the backend's SSE event stream.
 *
 * Events come from /api/deck/:id/stream. We parse them into:
 *   - The list of slide cards (one per template/focus_hint pair)
 *   - Each card's state (queued/researching/refining/ready/failed)
 *   - Live "Claude prose" ticker (text blocks streamed from the orchestrator)
 *   - The final assembled deck once the deck_assembled event arrives
 *
 * The hook handles:
 *   - Reconnect (the SSE bridge replays past events on subscribe — we just
 *     reset state on reconnect and let the replay rebuild it)
 *   - Cancel + restart
 *   - Insertion (calls insertDeck against Canva when the user clicks "Add")
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@canva/user";
import {
  cancelDeck as apiCancel,
  createDeck as apiCreate,
  getDeck as apiGet,
} from "src/api/api";
import { insertDeck } from "src/lib/deck_inserter";
import type {
  AssembledDeck,
  AssembledSlide,
  SlideCitation,
  TemplateId,
} from "src/templates/types";
import type { SlideCardState } from "src/components/slide_card";

// ===== Public types =====

export type DeckPhase = "idle" | "researching" | "ready" | "failed" | "inserting" | "inserted";

export type SlideCardModel = {
  /** Unique key — `${template_id}#${focus_hint}` */
  id: string;
  template_id: TemplateId;
  focus_hint: string;
  state: SlideCardState;
  detail?: string;
  preview?: string;
  citations?: SlideCitation[];
  error?: string;
  /** Soft informational note (non-error). Used for "budget exhausted" etc. */
  note?: string;
  /** Latest interaction_id (for refine flow). */
  interaction_id?: string;
  /** Raw content once ready (for the preview screen). */
  content?: Record<string, unknown> | null;
};

export type DeckUiState = {
  jobId: string | null;
  /** Which generation pipeline this run is using. */
  mode: "orchestrator" | "ultra";
  phase: DeckPhase;
  topic: string;
  /** Live "Claude is thinking…" prose ticker (last few text blocks). */
  ticker: string[];
  cards: SlideCardModel[];
  /** Total follow-ups Claude has fired (orchestrator mode only). */
  followUpsFired: number;
  /** Sources surfaced by Parallel during research. URL list grows as new ones come back. */
  sources: { considered: number; read: number; urls: string[] };
  error: string | null;
  /** Final deck (only set when phase === "ready"). */
  deck: AssembledDeck | null;
};

// ===== Backend event types (mirror orchestrator.ts OrchestratorEvent) =====

type ServerEvent =
  | { type: "started"; topic: string; ts: string }
  | {
      type: "phase";
      name:
        | "initial_and_reactive"
        | "cross_slide"
        | "assembly"
        | "ultra_research"
        | "ultra_formatting";
      ts: string;
    }
  | { type: "claude_text"; text: string; ts: string }
  | {
      type: "tool_use";
      tool_use_id: string;
      name: string;
      input: Record<string, unknown>;
      ts: string;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      name: string;
      template_id?: TemplateId;
      success: boolean;
      content?: Record<string, unknown> | null;
      citations?: SlideCitation[];
      interaction_id?: string;
      thinness_signals?: { citations_count: number; unique_domain_count: number };
      error?: string;
      ts: string;
    }
  | {
      // Forwarded from Parallel SSE in ultra8x mode — top-level "thinking".
      type: "parallel_message";
      kind: "exec_status" | "plan" | "tool";
      message: string;
      ts: string;
    }
  | {
      // Forwarded from Parallel SSE in ultra8x mode — sources discovered.
      type: "parallel_sources";
      considered: number;
      read: number;
      sample_urls: string[];
      ts: string;
    }
  | { type: "deck_assembled"; deck: AssembledDeck; ts: string }
  | { type: "failed"; error: string; ts: string };

// ===== Hook =====

export function useDeck(): {
  state: DeckUiState;
  start: (args: {
    topic: string;
    design_id: string;
    mode?: "orchestrator" | "ultra";
  }) => Promise<void>;
  attach: (jobId: string) => void;
  cancel: () => Promise<void>;
  reset: () => void;
  insert: () => Promise<void>;
  refineSlide: (cardId: string, instruction: string) => Promise<void>;
} {
  const [state, setState] = useState<DeckUiState>(makeInitialState());
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(makeInitialState());
  }, []);

  const attach = useCallback((jobId: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState((prev) => ({
      ...makeInitialState(),
      jobId,
      phase: "researching",
      topic: prev.topic,
    }));
    void streamJob(jobId, abortRef.current.signal, (mut) => setState(mut));
  }, []);

  const start = useCallback(
    async (args: {
      topic: string;
      design_id: string;
      mode?: "orchestrator" | "ultra";
    }) => {
      try {
        setState((s) => ({
          ...s,
          error: null,
          phase: "researching",
          topic: args.topic,
          mode: args.mode || "orchestrator",
        }));
        const { job_id } = await apiCreate(args);
        attach(job_id);
      } catch (err: unknown) {
        const e = err as Error & { status?: number; body?: unknown };
        // Surface 409s to the caller via state.error so the UI can prompt resume
        if (e.status === 409 && e.body && typeof e.body === "object") {
          const body = e.body as { active_job_id?: string; error?: string };
          if (body.active_job_id) {
            attach(body.active_job_id);
            return;
          }
        }
        setState((s) => ({
          ...s,
          phase: "failed",
          error: e.message || "Failed to create deck",
        }));
      }
    },
    [attach],
  );

  const cancel = useCallback(async () => {
    if (!state.jobId) return;
    try {
      await apiCancel(state.jobId);
    } catch {
      /* ignore */
    }
    abortRef.current?.abort();
    setState((s) => ({ ...s, phase: "failed", error: "Cancelled" }));
  }, [state.jobId]);

  const insert = useCallback(async () => {
    if (!state.deck) return;
    setState((s) => ({ ...s, phase: "inserting" }));
    try {
      const result = await insertDeck(state.deck);
      // Partial failure: some slides got rejected by Canva. Show inserted
      // count + which ones failed so the user knows what to look at.
      if (result.failed.length > 0) {
        const failedSummary = result.failed
          .map((f) => `slide ${f.index} (${f.template_id})`)
          .join(", ");
        setState((s) => ({
          ...s,
          phase: "inserted",
          error: `Inserted ${result.inserted} of ${
            result.inserted + result.failed.length
          } slides. Failed: ${failedSummary}. (See backend logs for details.)`,
        }));
      } else {
        setState((s) => ({ ...s, phase: "inserted", error: null }));
      }
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.deck]);

  const refineSlide = useCallback(
    async (cardId: string, instruction: string) => {
      // POST /api/deck/:id/refine — TODO: not implemented yet on backend.
      // Will be added once we wire in-progress refinement.
      // For now, log and no-op so the UI doesn't crash.
      // eslint-disable-next-line no-console
      console.warn("refineSlide not yet wired", { cardId, instruction });
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, attach, cancel, reset, insert, refineSlide };
}

// ===== Internals =====

function makeInitialState(): DeckUiState {
  return {
    jobId: null,
    mode: "orchestrator",
    phase: "idle",
    topic: "",
    ticker: [],
    cards: [],
    followUpsFired: 0,
    sources: { considered: 0, read: 0, urls: [] },
    error: null,
    deck: null,
  };
}

/**
 * Open an SSE connection to the backend deck stream and pipe events into
 * the React state via the provided mutator. Uses fetch + ReadableStream so
 * we can pass the Canva user token (EventSource doesn't support headers).
 */
async function streamJob(
  jobId: string,
  signal: AbortSignal,
  applyMut: (mut: (prev: DeckUiState) => DeckUiState) => void,
): Promise<void> {
  const token = await auth.getCanvaUserToken();
  const url = new URL(`/api/deck/${encodeURIComponent(jobId)}/stream`, BACKEND_HOST);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal,
    });
  } catch (err: unknown) {
    if ((err as DOMException).name === "AbortError") return;
    applyMut((s) => ({ ...s, phase: "failed", error: "Stream connection failed" }));
    return;
  }
  if (!res.ok || !res.body) {
    // Fall back to polling the snapshot endpoint for a final state in case
    // the stream is unreachable but the job actually completed.
    try {
      const snap = await apiGet(jobId);
      if (snap.status === "ready" && snap.result) {
        applyMut((s) => ({
          ...s,
          phase: "ready",
          deck: snap.result || null,
          topic: snap.topic,
        }));
      }
    } catch {
      /* ignore */
    }
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminal = false;
  while (!signal.aborted) {
    let read;
    try {
      read = await reader.read();
    } catch {
      break;
    }
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true });
    const records = buffer.split("\n\n");
    buffer = records.pop() || "";
    for (const record of records) {
      const evt = parseSseRecord(record);
      if (!evt) continue;
      handleEvent(evt, applyMut);
      if (evt.event === "deck_assembled" || evt.event === "failed") {
        sawTerminal = true;
      }
    }
  }
  // If the stream closed without a terminal event AND the request wasn't
  // aborted by us, the orchestration was likely interrupted (server
  // restart, network drop). Surface this so the user isn't stuck on a
  // forever-spinner.
  if (!sawTerminal && !signal.aborted) {
    applyMut((s) =>
      s.phase === "researching"
        ? {
            ...s,
            phase: "failed",
            error:
              "The deck stream ended unexpectedly. The backend may have restarted while researching. Try again.",
          }
        : s,
    );
  }
}

type ParsedRecord = { event: string; data: unknown };

function parseSseRecord(record: string): ParsedRecord | null {
  const lines = record.split("\n");
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    else if (line.startsWith("data:")) dataLines.push(line.slice(5));
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function handleEvent(
  rec: ParsedRecord,
  applyMut: (mut: (prev: DeckUiState) => DeckUiState) => void,
): void {
  if (rec.event === "replay_complete") return; // marker only
  const evt = rec.data as ServerEvent;
  switch (evt.type) {
    case "started":
      applyMut((s) => ({ ...s, topic: evt.topic, phase: "researching" }));
      return;
    case "claude_text":
      // Keep last 5 text blocks for the live ticker
      applyMut((s) => ({
        ...s,
        ticker: [...s.ticker, evt.text].slice(-5),
      }));
      return;
    case "parallel_message":
      // Ultra8x mode: top-level "thinking" comes from Parallel's SSE
      // progress_msg events, not from a Claude orchestrator. Show them
      // in the same ticker.
      applyMut((s) => ({
        ...s,
        ticker: [...s.ticker, evt.message].slice(-5),
      }));
      return;
    case "parallel_sources": {
      // Ultra8x mode: dedupe + grow the sources list. Sample URLs are
      // a rolling window from Parallel; merge with what we've already seen.
      const e = evt;
      applyMut((s) => {
        const seen = new Set(s.sources.urls);
        for (const u of e.sample_urls) {
          if (u && !seen.has(u)) seen.add(u);
        }
        return {
          ...s,
          sources: {
            considered: e.considered,
            read: e.read,
            urls: Array.from(seen),
          },
        };
      });
      return;
    }
    case "phase":
      // No state mutation needed; could surface in UI later
      return;
    case "tool_use":
      applyMut((s) => applyToolUse(s, evt));
      return;
    case "tool_result":
      applyMut((s) => applyToolResult(s, evt));
      return;
    case "deck_assembled":
      applyMut((s) => ({
        ...s,
        phase: "ready",
        deck: evt.deck,
        // Mark all cards corresponding to assembled slides as ready
        cards: s.cards.map((c) => {
          const matching = evt.deck.slides.find(
            (sl) => slideKey(sl.template_id, sl.focus_hint) === c.id,
          );
          if (matching) {
            return {
              ...c,
              state: "ready",
              content: matching.content,
              citations: matching.citations,
              preview: previewFromContent(c.template_id, matching.content),
            };
          }
          return c;
        }),
      }));
      return;
    case "failed":
      applyMut((s) => ({ ...s, phase: "failed", error: evt.error }));
      return;
  }
}

type ToolUseEvent = Extract<ServerEvent, { type: "tool_use" }>;
type ToolResultEvent = Extract<ServerEvent, { type: "tool_result" }>;

function applyToolUse(s: DeckUiState, evt: ToolUseEvent): DeckUiState {
  const input = evt.input;
  if (evt.name === "research_slide" || evt.name === "quote_hunt") {
    const template_id = (evt.name === "quote_hunt"
      ? "quote"
      : (input.template_id as TemplateId)) as TemplateId;
    const focus_hint = (input.focus_hint as string) || "";
    const id = slideKey(template_id, focus_hint);
    const existing = s.cards.find((c) => c.id === id);
    if (existing) {
      // Re-firing same slide (rare); just bump state
      return {
        ...s,
        cards: s.cards.map((c) =>
          c.id === id ? { ...c, state: "researching", detail: focus_hint } : c,
        ),
      };
    }
    return {
      ...s,
      cards: [
        ...s.cards,
        {
          id,
          template_id,
          focus_hint,
          state: "researching",
          detail: focus_hint,
        },
      ],
    };
  }
  if (evt.name === "follow_up_slide") {
    const template_id = input.template_id as TemplateId;
    const interaction_id = input.interaction_id as string;
    const instruction = input.instruction as string;
    const card = s.cards.find(
      (c) => c.template_id === template_id && c.interaction_id === interaction_id,
    );
    if (!card) return s;
    return {
      ...s,
      followUpsFired: s.followUpsFired + 1,
      cards: s.cards.map((c) =>
        c.id === card.id
          ? { ...c, state: "refining", detail: instruction }
          : c,
      ),
    };
  }
  return s;
}

function applyToolResult(s: DeckUiState, evt: ToolResultEvent): DeckUiState {
  // Merge any citations from this slide into the deck-wide sources strip
  // so orchestrator mode also gets a favicon list as research progresses.
  if (evt.citations && evt.citations.length > 0) {
    const seen = new Set(s.sources.urls);
    for (const c of evt.citations) {
      if (c.url && !seen.has(c.url)) seen.add(c.url);
    }
    if (seen.size !== s.sources.urls.length) {
      s = {
        ...s,
        sources: {
          considered: s.sources.considered,
          read: seen.size,
          urls: Array.from(seen),
        },
      };
    }
  }

  // Find the card this result belongs to: look for the most recent card
  // matching template_id that's in researching/refining state.
  const tid = evt.template_id;
  if (!tid) return s;
  const idx = [...s.cards]
    .map((c, i) => ({ c, i }))
    .reverse()
    .find(
      ({ c }) =>
        c.template_id === tid &&
        (c.state === "researching" || c.state === "refining"),
    );
  if (!idx) return s;
  const updatedCards = [...s.cards];
  const target = idx.c;
  if (evt.success && evt.content) {
    updatedCards[idx.i] = {
      ...target,
      state: "ready",
      content: evt.content,
      citations: evt.citations,
      interaction_id: evt.interaction_id || target.interaction_id,
      preview: previewFromContent(target.template_id, evt.content),
      detail: undefined,
      // Don't carry an old note forward once we have new content
      note: undefined,
    };
  } else {
    // Budget-exhausted is a non-error condition — Claude tried to refine
    // further but was capped. If the slide already had content from a
    // prior turn, keep it READY and surface the cap as a soft note.
    const isBudgetCap =
      typeof evt.error === "string" && evt.error.includes("budget exhausted");
    if (isBudgetCap && target.content) {
      updatedCards[idx.i] = {
        ...target,
        state: "ready",
        // Drop the in-flight follow-up instruction from `detail`
        detail: undefined,
        note: "Follow-up limit reached for this slide",
      };
    } else if (target.content) {
      // Other follow-up failure modes when prior content exists — also
      // keep the slide ready, just surface the failure as a note.
      updatedCards[idx.i] = {
        ...target,
        state: "ready",
        detail: undefined,
        note: `Follow-up didn't land: ${evt.error || "no content"}`,
      };
    } else {
      // True failure — no prior content, nothing to fall back to
      updatedCards[idx.i] = {
        ...target,
        state: "failed",
        error: evt.error || "Worker returned no content",
      };
    }
  }
  return { ...s, cards: updatedCards };
}

function slideKey(template_id: TemplateId, focus_hint: string): string {
  return `${template_id}#${focus_hint}`;
}

/**
 * Pull a one-line preview out of slide content (varies per template).
 * Used as the "ready" card's headline.
 */
function previewFromContent(
  template_id: TemplateId,
  content: Record<string, unknown> | null,
): string | undefined {
  if (!content) return undefined;
  const c = content as Record<string, unknown>;
  switch (template_id) {
    case "cover":
      return typeof c.title === "string" ? c.title : undefined;
    case "summary": {
      const t = (c.takeaways as Array<{ headline?: string }> | undefined)?.[0]
        ?.headline;
      return t || (typeof c.title === "string" ? c.title : undefined);
    }
    case "divider":
      return typeof c.chapterTitle === "string" ? c.chapterTitle : undefined;
    case "callout": {
      const stat = (c.stats as Array<{ number?: string; suffix?: string }> | undefined)?.[0];
      if (!stat) return typeof c.title === "string" ? c.title : undefined;
      return `${stat.number || ""}${stat.suffix || ""}  ·  ${c.title || ""}`;
    }
    case "timeline":
    case "brief":
    case "matrix":
      return typeof c.title === "string" ? c.title : undefined;
    case "quote": {
      const text = typeof c.text === "string" ? c.text : "";
      const name = typeof c.name === "string" ? c.name : "";
      return `${truncate(text, 80)}  — ${name}`;
    }
    case "appendix":
      return `${(c.citations as unknown[] | undefined)?.length || 0} sources`;
    case "deeper_findings_table":
    case "deeper_findings_text":
      return typeof c.title === "string" ? c.title : "Deeper findings";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
