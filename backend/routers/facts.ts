/**
 * /api/facts — synchronous fact-cards endpoint.
 *
 * Unlike /api/deck (which orchestrates 7-12 slides over several minutes),
 * fact cards are a single Chat API `core` call that returns in ~30s.
 * No job manager / SSE / persistence needed — simple POST and return.
 *
 * Response shape:
 *   { claims: Array<{ id, headline, stat, context, category?, citations[] }> }
 *
 * Each claim's citations are flattened from Parallel's basis array,
 * scoped to the field the citation supports when possible (claims[i].stat
 * vs claims[i].context). Falls back to all-deck citations if field-path
 * matching fails.
 */
import express from "express";
import { randomUUID } from "crypto";
import { chatComplete } from "../lib/parallel_client";
import { buildFactsPrompt, factsSchema } from "../templates/facts";

type RawClaim = {
  headline: string;
  stat: string;
  context: string;
  category?: string;
};

type Citation = {
  url: string;
  title: string;
  excerpts: string[];
  confidence?: "high" | "medium" | "low";
};

type EnrichedClaim = RawClaim & {
  id: string;
  citations: Citation[];
};

function flattenCitations(
  basis: Array<{
    field: string;
    citations?: Array<{ url: string; title: string | null; excerpts: string[] | null }>;
    confidence?: "high" | "medium" | "low";
  }> | undefined,
): Map<string, Citation[]> {
  const map = new Map<string, Citation[]>();
  if (!basis) return map;
  for (const entry of basis) {
    const list: Citation[] = [];
    for (const c of entry.citations || []) {
      if (!c.url) continue;
      list.push({
        url: c.url,
        title: c.title || hostname(c.url),
        excerpts: c.excerpts || [],
        confidence: entry.confidence,
      });
    }
    if (list.length > 0) map.set(entry.field, list);
  }
  return map;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function citationsForClaim(
  basisMap: Map<string, Citation[]>,
  index: number,
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const [field, cites] of basisMap.entries()) {
    if (
      field === `claims[${index}]` ||
      field.startsWith(`claims[${index}].`) ||
      field === `claims.${index}` ||
      field.startsWith(`claims.${index}.`)
    ) {
      for (const c of cites) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        out.push(c);
      }
    }
  }
  return out;
}

function allCitations(basisMap: Map<string, Citation[]>): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const cites of basisMap.values()) {
    for (const c of cites) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      out.push(c);
    }
  }
  return out;
}

export function createFactsRouter() {
  const router = express.Router();

  router.post("/api/facts", async (req, res) => {
    const { topic } = req.body as { topic?: string };
    if (!topic || typeof topic !== "string" || topic.length < 4) {
      return res.status(400).json({ error: "topic is required (>= 4 chars)" });
    }

    try {
      // eslint-disable-next-line no-console
      console.log(`[facts] researching (Chat API core): ${topic}`);
      const t0 = Date.now();

      // Chat API `core` is faster than the Task API equivalent (~30s vs
      // 30-90s) and returns inline with a single HTTP round-trip — no
      // polling. Citations come back via the `basis` field on the
      // response, same shape as Task API.
      const resp = await chatComplete({
        model: "core",
        messages: [{ role: "user", content: buildFactsPrompt(topic) }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "facts", schema: factsSchema },
        },
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const basis = resp.basis || [];
      // eslint-disable-next-line no-console
      console.log(
        `[facts] ${topic} → completed in ${elapsed}s (basis fields: ${basis.length})`,
      );

      const raw = resp.choices[0]?.message?.content;
      if (!raw) {
        return res.status(502).json({ error: "Empty response from research" });
      }
      let parsed: { claims: RawClaim[] };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(502).json({ error: "Could not parse research output" });
      }
      if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) {
        return res.status(502).json({ error: "No claims returned" });
      }

      // Enrich each claim with its citations (per-field if possible)
      const basisMap = flattenCitations(basis);
      const fallback = allCitations(basisMap);
      const enriched: EnrichedClaim[] = parsed.claims.map((c, i) => {
        const perClaim = citationsForClaim(basisMap, i);
        return {
          id: randomUUID(),
          headline: c.headline,
          stat: c.stat,
          context: c.context,
          category: c.category,
          citations: perClaim.length > 0 ? perClaim : fallback,
        };
      });

      return res.json({
        topic,
        claims: enriched,
        elapsed_seconds: Number(elapsed),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[facts] error:`, msg);
      return res.status(500).json({ error: msg });
    }
  });

  return router;
}
