/**
 * "Deeper findings" pass — runs alongside the deck orchestrator on a
 * separate Parallel Task. Uses `pro-fast` with `output_schema: { type: "text" }`
 * so the model can return open-ended markdown instead of fitting a fixed
 * schema. We prompt it to lead with a markdown table of surprising
 * players/stats, followed by 2-3 paragraphs of analysis.
 *
 * This is purely additive: if the task fails, times out, or returns
 * unparseable text, the deck ships without the deeper-findings slide.
 * The orchestrator + slide flow are untouched.
 *
 * Returns an `AssembledSlide` ready to append to the deck:
 *   - template_id "deeper_findings_table" if a markdown table parsed cleanly
 *   - template_id "deeper_findings_text"  if no table found (text-only)
 */
import { runTaskToCompletion, type BasisEntry } from "./parallel_client";
import type {
  AssembledSlide,
  SlideCitation,
  TemplateId,
} from "../templates/types";

const TIMEOUT_MS = 8 * 60 * 1000; // pro-fast usually finishes in 2-5 min; cap at 8

export type DeeperFindingsResult =
  | { kind: "ok"; slide: AssembledSlide; elapsed_seconds: number }
  | { kind: "skipped"; reason: string };

function buildPrompt(topic: string): string {
  return [
    `Surface the most SURPRISING, lesser-known findings about: '${topic}'.`,
    "",
    "Goal: a single 'deeper findings' slide that goes beyond the obvious — niche players, counterintuitive stats, hidden technical details, recent (2024-2026) shifts that haven't hit mainstream coverage yet.",
    "",
    "Format your response in markdown:",
    "",
    "1. BEGIN with a single H2 line: `## <punchy 6-10 word title for the finding>`",
    "2. THEN a markdown table comparing the 4-5 most interesting players, frameworks, or data points. Choose columns that fit the topic — common shapes:",
    "   - { Company | Founded | Funding | Notable Customers | Differentiator }",
    "   - { Tool    | Approach | Strengths | Weaknesses | Best For }",
    "   - { Metric  | 2024 | 2025 | 2026 | Source }",
    "",
    "   Pick 4-5 columns max (so it fits on one slide). Keep cells short — ideally under 12 words each.",
    "3. THEN 2-3 short paragraphs (separated by blank lines) of deeper analysis surfacing the angle, named sources, dates, and quantitative claims.",
    "",
    "Cite real public sources inline (analyst reports, filings, reputable publications). Skip generic stats everyone already knows — surface what would make a domain expert pause.",
  ].join("\n");
}

/**
 * Pull a Markdown H2 (`## ...`) line as the slide title, falling back to
 * the topic if the model didn't emit one. The line is consumed (removed)
 * so it doesn't get rendered again as body text.
 */
function extractTitle(
  text: string,
  fallback: string,
): { title: string; remaining: string } {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && m[1]) {
      const title = m[1].replace(/\*\*/g, "").trim();
      const remaining = [...lines.slice(0, i), ...lines.slice(i + 1)]
        .join("\n")
        .trim();
      return { title, remaining };
    }
  }
  return { title: `Deeper findings: ${fallback}`, remaining: text.trim() };
}

/**
 * Parse the FIRST markdown table from text. Returns null if no valid
 * table (header row + separator `|---|---|` + data rows) is found.
 * Strips the table block from `remaining` so the analysis paragraphs
 * don't contain it.
 */
export type ParsedTable = {
  columns: string[];
  rows: string[][];
};

export function parseFirstMarkdownTable(text: string): {
  table: ParsedTable | null;
  remaining: string;
} {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = (lines[i] ?? "").trim();
    const b = (lines[i + 1] ?? "").trim();
    // Header row: starts and ends with |
    // Separator row: only |, -, :, spaces
    if (a.startsWith("|") && a.endsWith("|") && /^\|[\s:|-]+\|$/.test(b)) {
      start = i;
      break;
    }
  }
  if (start < 0) return { table: null, remaining: text };

  const splitCells = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());

  const columns = splitCells(lines[start] ?? "");
  const rows: string[][] = [];
  let end = start + 1; // separator row consumed
  for (let i = start + 2; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (!t.startsWith("|")) {
      end = i - 1;
      break;
    }
    const cells = splitCells(t);
    // Pad/truncate to column count for safety
    while (cells.length < columns.length) cells.push("");
    if (cells.length > columns.length) cells.length = columns.length;
    rows.push(cells);
    end = i;
  }
  if (rows.length === 0) return { table: null, remaining: text };

  const remaining = [
    ...lines.slice(0, start),
    ...lines.slice(end + 1),
  ]
    .join("\n")
    .trim();
  return { table: { columns, rows }, remaining };
}

/** Flatten Parallel basis entries to a flat citation list (deduped by URL). */
function flattenBasis(basis: BasisEntry[] | undefined): SlideCitation[] {
  const seen = new Set<string>();
  const out: SlideCitation[] = [];
  for (const entry of basis || []) {
    for (const c of entry.citations || []) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      out.push({
        url: c.url,
        title: c.title || hostname(c.url),
        excerpts: c.excerpts || [],
        confidence: entry.confidence,
      });
    }
  }
  return out;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Run a deeper-findings task and return an AssembledSlide ready to
 * append to the deck. Failures are returned as `skipped` with a reason —
 * the caller logs it but ships the deck anyway.
 */
export async function runDeeperFindings(topic: string): Promise<DeeperFindingsResult> {
  const t0 = Date.now();
  try {
    // eslint-disable-next-line no-console
    console.log(`[deeper_findings] running pro-fast for "${topic}"`);
    const result = await runTaskToCompletion<string>(
      {
        processor: "pro-fast",
        task_spec: { output_schema: { type: "text" } },
        input: buildPrompt(topic),
      },
      { timeoutMs: TIMEOUT_MS, pollMs: 5000 },
    );
    const elapsed = Math.round((Date.now() - t0) / 1000);

    const raw = result.output?.content;
    const text = typeof raw === "string" ? raw : "";
    if (!text || text.length < 50) {
      return { kind: "skipped", reason: "empty or too-short output" };
    }

    const { title, remaining: afterTitle } = extractTitle(text, topic);
    const { table, remaining: body } = parseFirstMarkdownTable(afterTitle);
    const citations = flattenBasis(result.output?.basis || result.basis);

    const template_id: TemplateId = table
      ? "deeper_findings_table"
      : "deeper_findings_text";
    const content = table
      ? { title, columns: table.columns, rows: table.rows, body }
      : { title, body };

    // eslint-disable-next-line no-console
    console.log(
      `[deeper_findings] completed in ${elapsed}s — ${
        table ? `table ${table.rows.length}×${table.columns.length}` : "text-only"
      }, ${citations.length} citations`,
    );

    return {
      kind: "ok",
      elapsed_seconds: elapsed,
      slide: {
        template_id,
        focus_hint: "deeper findings",
        content,
        citations,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[deeper_findings] skipped: ${msg}`);
    return { kind: "skipped", reason: msg };
  }
}
