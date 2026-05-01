import express from "express";
import {
  cancelJob,
  createDeckJob,
  findActiveForDesign,
  getJob,
  jobSummary,
  listForDesign,
  subscribe,
} from "../lib/deck_jobs";

export function createDeckRouter() {
  const router = express.Router();

  /**
   * POST /api/deck
   * Body: { topic: string, design_id: string }
   * Returns: { job_id }
   *
   * If a deck job is already researching for this design, returns 409 with
   * { active_job_id } so the client can show the resume banner instead of
   * starting a duplicate run.
   */
  router.post("/api/deck", (req, res) => {
    const { topic, design_id, mode } = req.body as {
      topic?: string;
      design_id?: string;
      mode?: "orchestrator" | "ultra";
    };
    if (!topic || typeof topic !== "string" || topic.length < 4) {
      return res.status(400).json({ error: "topic is required (>= 4 chars)" });
    }
    if (!design_id || typeof design_id !== "string") {
      return res.status(400).json({ error: "design_id is required" });
    }
    const resolvedMode =
      mode === "ultra" || mode === "orchestrator" ? mode : "orchestrator";
    try {
      const { job_id } = createDeckJob({ topic, design_id, mode: resolvedMode });
      return res.json({ job_id });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "RESEARCHING_JOB_EXISTS") {
        const activeJobId = (err as Error & { active_job_id?: string }).active_job_id;
        return res.status(409).json({
          error: "A deck is already in progress for this design",
          active_job_id: activeJobId,
        });
      }
      // eslint-disable-next-line no-console
      console.error("POST /api/deck error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/deck/active?design_id=…
   * Returns the most recent (active or recently-finished) job for the design,
   * or 404 if none. Used by the home page to show the resume banner.
   */
  router.get("/api/deck/active", (req, res) => {
    const design_id = String(req.query.design_id || "");
    if (!design_id) return res.status(400).json({ error: "design_id required" });
    const job = findActiveForDesign(design_id);
    if (!job) return res.status(404).json({ error: "No deck job for this design" });
    return res.json(jobSummary(job));
  });

  /**
   * GET /api/deck/list?design_id=…
   * Returns all decks ever generated for this design (most recent first).
   * Used by the home page "Previous decks" history list. Includes ready,
   * failed, cancelled, and in-progress jobs. Persisted on disk so they
   * survive backend restarts.
   */
  router.get("/api/deck/list", (req, res) => {
    const design_id = String(req.query.design_id || "");
    if (!design_id) return res.status(400).json({ error: "design_id required" });
    const jobs = listForDesign(design_id);
    return res.json({ jobs: jobs.map(jobSummary) });
  });

  /**
   * GET /api/deck/:jobId
   * Snapshot of a job's current state — status, summary, full result if ready.
   */
  router.get("/api/deck/:jobId", (req, res) => {
    const job = getJob(req.params.jobId || "");
    if (!job) return res.status(404).json({ error: "Job not found" });
    return res.json({
      ...jobSummary(job),
      result: job.result,
      error: job.error,
    });
  });

  /**
   * GET /api/deck/:jobId/stream
   * SSE — replays every past event on connect, then streams new events as
   * the orchestrator emits them. Closes when status is terminal.
   */
  router.get("/api/deck/:jobId/stream", (req, res): void => {
    const job = getJob(req.params.jobId || "");
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let alive = true;
    const close = () => {
      alive = false;
      sub?.unsubscribe();
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    req.on("close", close);

    // Heartbeat to keep intermediaries from timing out the stream.
    const ka = setInterval(() => {
      if (!alive) return;
      try {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        clearInterval(ka);
        close();
      }
    }, 15000);

    const send = (eventName: string, data: unknown) => {
      if (!alive) return;
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        clearInterval(ka);
        close();
      }
    };

    const sub = subscribe(req.params.jobId || "", (evt) => {
      send(evt.type, evt);
      // If we receive a terminal event, end the stream after a short flush.
      if (evt.type === "deck_assembled" || evt.type === "failed") {
        setTimeout(() => {
          clearInterval(ka);
          close();
        }, 500);
      }
    });

    if (!sub) {
      send("failed", { type: "failed", error: "Job not found", ts: new Date().toISOString() });
      clearInterval(ka);
      close();
      return;
    }

    // Send a one-time `replay_complete` marker so clients can flip from
    // "catching up" to "live" UI without ambiguity.
    send("replay_complete", { replayed: sub.replayed, ts: new Date().toISOString() });

    // If the job was already terminal at subscribe time, close.
    if (job.status === "ready" || job.status === "failed" || job.status === "cancelled") {
      setTimeout(() => {
        clearInterval(ka);
        close();
      }, 500);
    }
  });

  /**
   * POST /api/deck/:jobId/cancel
   * Marks a researching job as cancelled. Workers in flight finish naturally;
   * Claude's next turn won't fire.
   */
  router.post("/api/deck/:jobId/cancel", (req, res) => {
    const ok = cancelJob(req.params.jobId || "");
    if (!ok) return res.status(409).json({ error: "Cannot cancel — job not researching" });
    return res.json({ ok: true });
  });

  return router;
}
