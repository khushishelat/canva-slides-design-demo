/**
 * In-memory deck job store with event log + SSE-friendly subscribe pattern.
 *
 * Why this exists:
 *   - Orchestrations take 2-10 minutes. The browser may close the sidebar
 *     mid-run. We must keep the run alive server-side.
 *   - Frontend may reconnect multiple times. On each reconnect we replay
 *     all past events first, then push live events.
 *
 * Storage: process-local Map. Sufficient for single-backend dev mode.
 * If we ever multi-replica, swap to Redis/SQLite without changing the
 * public API.
 */
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { orchestrateDeck, type OrchestratorEvent } from "./orchestrator";
import { runDeeperFindings } from "./deeper_findings";
import { synthesizeFinalDeck } from "./synthesizer";
import { runUltraDeck } from "./ultra_deck";
import type { AssembledDeck } from "../templates/types";

export type DeckMode = "orchestrator" | "ultra";

// ===== On-disk persistence =====
//
// We store every deck job at `.deck-jobs/<id>.json` so research survives
// backend restarts. Without this, an HMR reload during a long deck run
// loses everything; the user sees a forever-spinner and has to start
// over. With it, on next startup we hydrate the in-memory map from disk
// and the user can resume or browse previous decks.
//
// Trade-off: we write the file on every event append. For a 10-min deck
// with ~30 events, that's 30 small fs.writeFile calls — negligible.

const JOBS_DIR = path.resolve(process.cwd(), ".deck-jobs");

function ensureDir(): void {
  try {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function jobPath(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

/** Persist a job to disk. Excludes runtime-only fields (subscribers, cancelToken). */
function persistJob(job: DeckJob): void {
  ensureDir();
  const persistable = {
    id: job.id,
    design_id: job.design_id,
    topic: job.topic,
    mode: job.mode,
    created_at: job.created_at,
    updated_at: job.updated_at,
    status: job.status,
    events: job.events,
    result: job.result,
    error: job.error,
  };
  try {
    fs.writeFileSync(jobPath(job.id), JSON.stringify(persistable, null, 2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[deck_jobs] failed to persist ${job.id}:`, err);
  }
}

function deletePersisted(id: string): void {
  try {
    fs.unlinkSync(jobPath(id));
  } catch {
    /* ignore */
  }
}

/**
 * Load all persisted jobs into the in-memory map on startup.
 * Any job that was still "researching" when the process died is
 * marked failed — we can't resume mid-Claude-loop.
 */
function hydrateFromDisk(): void {
  ensureDir();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(JOBS_DIR);
  } catch {
    return;
  }
  let loaded = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(JOBS_DIR, entry), "utf8");
      const data = JSON.parse(raw) as Omit<DeckJob, "subscribers" | "cancelToken">;
      const wasInFlight = data.status === "researching";
      const job: DeckJob = {
        ...data,
        mode: data.mode || "orchestrator",
        status: wasInFlight ? "failed" : data.status,
        error: wasInFlight
          ? "Server restarted while researching. Start a new deck."
          : data.error,
        subscribers: new Set(),
        cancelToken: { cancelled: wasInFlight },
      };
      // If it was in-flight, also append a synthetic failed event so the
      // event log accurately tells the story to anyone who replays.
      if (wasInFlight) {
        job.events.push({
          type: "failed",
          error: "Server restarted while researching",
          ts: new Date().toISOString(),
        });
      }
      JOBS.set(job.id, job);
      // Re-persist the corrected status
      if (wasInFlight) persistJob(job);
      loaded++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[deck_jobs] failed to hydrate ${entry}:`, err);
    }
  }
  if (loaded > 0) {
    // eslint-disable-next-line no-console
    console.log(`[deck_jobs] hydrated ${loaded} jobs from disk`);
  }
}

export type DeckJobStatus =
  | "researching"
  | "ready"
  | "failed"
  | "cancelled";

export type DeckJob = {
  id: string;
  design_id: string;
  topic: string;
  /** Which generation pipeline produced this deck. Defaults to "orchestrator" for legacy jobs. */
  mode: DeckMode;
  created_at: number;
  updated_at: number;
  status: DeckJobStatus;
  events: OrchestratorEvent[];
  result?: AssembledDeck;
  error?: string;
  /** Subscribers receive new events as they're emitted. */
  subscribers: Set<(evt: OrchestratorEvent) => void>;
  /** Set when status moves out of "researching"; reject pending sleeps. */
  cancelToken: { cancelled: boolean };
};

const JOBS = new Map<string, DeckJob>();
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — long enough to call it "history"

function prune(): void {
  const now = Date.now();
  for (const [id, job] of JOBS.entries()) {
    if (now - job.updated_at > TTL_MS) {
      JOBS.delete(id);
      deletePersisted(id);
    }
  }
}

// Hydrate jobs from disk on module load. Called once at startup.
hydrateFromDisk();

/**
 * Find an active (still-researching or just-finished) job for this design id.
 * Returns the most recent one. Used by the home page resume banner.
 */
export function findActiveForDesign(design_id: string): DeckJob | null {
  prune();
  let candidate: DeckJob | null = null;
  for (const job of JOBS.values()) {
    if (job.design_id !== design_id) continue;
    if (!candidate || job.updated_at > candidate.updated_at) {
      candidate = job;
    }
  }
  return candidate;
}

export function getJob(id: string): DeckJob | null {
  prune();
  return JOBS.get(id) || null;
}

/**
 * Create a new deck job and start the orchestration in the background.
 * Returns immediately with the job id.
 *
 * If a researching job already exists for this design, throws — caller
 * handles 409 by surfacing the existing job_id to the resume banner.
 */
export function createDeckJob(args: {
  design_id: string;
  topic: string;
  mode?: DeckMode;
}): { job_id: string } {
  prune();
  const existing = findActiveForDesign(args.design_id);
  if (existing && existing.status === "researching") {
    const err = new Error("RESEARCHING_JOB_EXISTS");
    (err as Error & { active_job_id?: string }).active_job_id = existing.id;
    throw err;
  }

  const id = randomUUID();
  const now = Date.now();
  const job: DeckJob = {
    id,
    design_id: args.design_id,
    topic: args.topic,
    mode: args.mode || "orchestrator",
    created_at: now,
    updated_at: now,
    status: "researching",
    events: [],
    subscribers: new Set(),
    cancelToken: { cancelled: false },
  };
  JOBS.set(id, job);
  persistJob(job);

  // Run orchestration in the background. The fetch/Anthropic SDK calls
  // continue even if the originating HTTP request closed.
  void runOrchestration(job).catch((err: unknown) => {
    // Catastrophic failure should not crash the server; we record it and
    // notify subscribers via a "failed" event.
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(job, { type: "failed", error: message, ts: new Date().toISOString() });
    job.status = "failed";
    job.error = message;
    job.updated_at = Date.now();
  });

  return { job_id: id };
}

async function runOrchestration(job: DeckJob): Promise<void> {
  if (job.mode === "ultra") {
    await runUltraOrchestration(job);
    return;
  }
  await runStandardOrchestration(job);
}

async function runUltraOrchestration(job: DeckJob): Promise<void> {
  try {
    const deck = await runUltraDeck(job.topic, (evt) => {
      appendEvent(job, evt);
      if (evt.type === "failed") {
        job.status = "failed";
        job.error = evt.error;
      }
      job.updated_at = Date.now();
    });
    if (job.status === "researching") {
      job.status = "ready";
      job.result = deck;
      job.updated_at = Date.now();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(job, { type: "failed", error: message, ts: new Date().toISOString() });
    job.status = "failed";
    job.error = message;
    job.updated_at = Date.now();
  }
  persistJob(job);
}

async function runStandardOrchestration(job: DeckJob): Promise<void> {
  try {
    // Kick off the "deeper findings" pro-fast task in parallel with the
    // orchestrator. This is a separate Parallel Task that explores
    // surprising/lesser-known angles and returns a markdown table +
    // analysis. It's purely additive — never blocks deck shipment.
    //
    // We intercept the orchestrator's `deck_assembled` event so we can
    // append the deeper-findings slide BEFORE forwarding it to SSE
    // subscribers. The frontend transitions to "ready" when it sees
    // deck_assembled, so we only want it to fire once with the final
    // (augmented) deck.
    const findingsPromise = runDeeperFindings(job.topic).catch((err) => ({
      kind: "skipped" as const,
      reason: err instanceof Error ? err.message : String(err),
    }));

    let pendingDeckAssembled: OrchestratorEvent | null = null;
    const deck = await orchestrateDeck(job.topic, (evt) => {
      if (evt.type === "deck_assembled") {
        // Defer — we'll re-emit after merging the deeper-findings slide
        pendingDeckAssembled = evt;
        return;
      }
      appendEvent(job, evt);
      if (evt.type === "failed") {
        job.status = "failed";
        job.error = evt.error;
      }
      job.updated_at = Date.now();
    });

    // Wait on deeper-findings (capped by its internal timeout). If it
    // beats the orchestrator we essentially don't wait at all here.
    const findings = await findingsPromise;
    let finalDeck = deck;
    if (findings.kind === "ok") {
      finalDeck = { ...deck, slides: [...deck.slides, findings.slide] };
      // eslint-disable-next-line no-console
      console.log(
        `[deck_jobs] appended ${findings.slide.template_id} slide (${findings.elapsed_seconds}s)`,
      );

      // Run synthesizer pass — give Claude one final chance to fold
      // insights from the deeper findings into the body slides (matrix
      // additions, sharper callout stats, etc.). Failures here never
      // block deck shipment.
      try {
        const t0 = Date.now();
        const synth = await synthesizeFinalDeck(finalDeck);
        finalDeck = synth.deck;
        // eslint-disable-next-line no-console
        console.log(
          `[deck_jobs] synthesizer applied ${synth.result.applied} edit(s) in ${
            ((Date.now() - t0) / 1000).toFixed(1)
          }s${synth.result.notes ? ` — ${synth.result.notes.slice(0, 120)}` : ""}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[deck_jobs] synthesizer skipped: ${msg}`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[deck_jobs] deeper-findings skipped: ${findings.reason}`);
    }

    // Re-emit deck_assembled with the augmented deck so SSE consumers
    // see the deeper-findings slide and any synthesizer edits.
    if (pendingDeckAssembled) {
      appendEvent(job, {
        type: "deck_assembled",
        deck: finalDeck,
        ts: new Date().toISOString(),
      });
    }

    if (job.status === "researching" || job.status === "ready") {
      job.status = "ready";
      job.result = finalDeck;
      job.updated_at = Date.now();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(job, { type: "failed", error: message, ts: new Date().toISOString() });
    job.status = "failed";
    job.error = message;
    job.updated_at = Date.now();
    persistJob(job);
  }
  // Final persist after orchestration finishes (success path)
  persistJob(job);
}

function appendEvent(job: DeckJob, evt: OrchestratorEvent): void {
  job.events.push(evt);
  job.updated_at = Date.now();
  // Notify all current subscribers; suppress per-subscriber errors so one
  // bad client doesn't break the others.
  for (const sub of job.subscribers) {
    try {
      sub(evt);
    } catch {
      /* ignore */
    }
  }
  // Persist on every event so an unexpected process exit doesn't lose
  // the most recent state. The write is small and async-fire-and-forget
  // wouldn't help here (Node fs.writeFileSync is fast enough).
  persistJob(job);
}

/**
 * Subscribe to a job's event stream. Immediately replays all past events
 * via the callback, then forwards new events as they arrive. Returns an
 * unsubscribe function.
 */
export function subscribe(
  jobId: string,
  cb: (evt: OrchestratorEvent) => void,
): { unsubscribe: () => void; replayed: number } | null {
  const job = JOBS.get(jobId);
  if (!job) return null;
  // Replay synchronously
  for (const evt of job.events) cb(evt);
  job.subscribers.add(cb);
  return {
    unsubscribe: () => {
      job.subscribers.delete(cb);
    },
    replayed: job.events.length,
  };
}

export function cancelJob(jobId: string): boolean {
  const job = JOBS.get(jobId);
  if (!job) return false;
  if (job.status !== "researching") return false;
  job.cancelToken.cancelled = true;
  job.status = "cancelled";
  job.updated_at = Date.now();
  appendEvent(job, {
    type: "failed",
    error: "Cancelled by user",
    ts: new Date().toISOString(),
  });
  persistJob(job);
  return true;
}

/**
 * List all jobs for a design (most recent first), excluding any over the
 * TTL. Used by the home page "Previous decks" history.
 */
export function listForDesign(design_id: string): DeckJob[] {
  prune();
  const out: DeckJob[] = [];
  for (const job of JOBS.values()) {
    if (job.design_id !== design_id) continue;
    out.push(job);
  }
  out.sort((a, b) => b.updated_at - a.updated_at);
  return out;
}

/** Public-API summary view (for /api/deck/active and the 409 body). */
export function jobSummary(job: DeckJob): {
  job_id: string;
  design_id: string;
  topic: string;
  mode: DeckMode;
  status: DeckJobStatus;
  created_at: number;
  updated_at: number;
  slide_count?: number;
} {
  return {
    job_id: job.id,
    design_id: job.design_id,
    topic: job.topic,
    mode: job.mode,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    slide_count: job.result?.slides.length,
  };
}
