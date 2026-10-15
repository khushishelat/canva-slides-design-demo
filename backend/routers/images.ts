/**
 * /api/images — web images of what a slide names (Parallel Image Search).
 *
 * Two calls so the sidebar can show progress as it happens:
 *   POST /api/images/plan    { text }               → { subjects, session_id }
 *       Parallel Chat API reads the slide text and lists the named subjects.
 *   POST /api/images/search  { subject, session_id } → SubjectImages
 *       Parallel Image Search for one subject, filtered to images Canva can
 *       upload and ranked first-party first. The sidebar fires one per
 *       subject in parallel.
 *   POST /api/images/fetch   { url }                → FetchedImage
 *       Downloads the image the user clicked and returns a data URL for
 *       Canva's upload() (see image_candidates.ts for why).
 */
import express from "express";
import { randomUUID } from "crypto";
import {
  fetchImageForUpload,
  findImagesForSubject,
} from "../lib/image_candidates";
import { planVisualSubjects, type VisualSubject } from "../lib/visual_subjects";

export function createImagesRouter() {
  const router = express.Router();

  router.post("/api/images/plan", async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string" || text.trim().length < 4) {
      return res.status(400).json({ error: "text is required (>= 4 chars)" });
    }
    try {
      const t0 = Date.now();
      const { subjects, fallback } = await planVisualSubjects(
        text.trim().slice(0, 4000),
      );
      const elapsed = (Date.now() - t0) / 1000;
      // eslint-disable-next-line no-console
      console.log(
        `[images] plan → ${subjects.length} subjects in ${elapsed.toFixed(1)}s` +
          (fallback ? " (fallback)" : "") +
          `: ${subjects.map((s) => s.label).join(" · ")}`,
      );
      return res.json({
        subjects,
        fallback,
        session_id: `session_${randomUUID().replace(/-/g, "")}`,
        elapsed_seconds: elapsed,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[images] plan error:`, msg);
      return res.status(500).json({ error: msg });
    }
  });

  router.post("/api/images/search", async (req, res) => {
    const { subject, session_id } = req.body as {
      subject?: VisualSubject;
      session_id?: string;
    };
    if (
      !subject ||
      !Array.isArray(subject.search_queries) ||
      subject.search_queries.length === 0
    ) {
      return res.status(400).json({ error: "subject is required" });
    }
    try {
      const t0 = Date.now();
      const result = await findImagesForSubject(subject, session_id);
      const elapsed = (Date.now() - t0) / 1000;
      // eslint-disable-next-line no-console
      console.log(
        `[images] search "${subject.label}" → ${result.images.length} usable ` +
          `(returned ${result.counts.returned}, stock -${result.counts.stock_dropped}, ` +
          `not uploadable -${result.counts.not_uploadable}) in ${elapsed.toFixed(1)}s`,
      );
      return res.json({ ...result, elapsed_seconds: elapsed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[images] search error:`, msg);
      return res.status(500).json({ error: msg });
    }
  });

  router.post("/api/images/fetch", async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }
    try {
      return res.json(await fetchImageForUpload(url));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[images] fetch error for ${url}:`, msg);
      return res.status(502).json({ error: msg });
    }
  });

  return router;
}
