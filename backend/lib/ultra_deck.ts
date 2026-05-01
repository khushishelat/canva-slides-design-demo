/**
 * "Ultra" deck mode — alternative to the orchestrator-driven approach.
 * The processor tier is tunable (currently `ultra2x`). The mode key on
 * the API surface is the tier-agnostic string `"ultra"` so we can swap
 * the underlying processor (ultra → ultra2x → ultra4x → ultra8x)
 * without churning routes, persisted job records, or frontend types.
 *
 * Architecture:
 *   1. Single ultra-tier Task API call with `output_schema: { type: "text" }`
 *      (open-ended markdown, no schema). enable_events: true so we can
 *      stream Parallel's reasoning trace + source discovery to the UI.
 *   2. SSE forward — Parallel emits progress_msg.* (top-level thinking)
 *      and progress_stats (sources read/considered + sample URLs). We
 *      forward each to the deck-job emit() so the frontend renders them
 *      in the same live ticker + favicon chip strip used by the
 *      orchestrator mode.
 *   3. When the Task completes, run a Sonnet formatter pass that maps
 *      the markdown into the same AssembledDeck shape the orchestrator
 *      produces (template_id + content per slide, schema-validated by
 *      the per-template tool input_schema).
 *   4. Same render pipeline → apples-to-apples comparison vs orchestrator.
 *
 * Why a separate module: keeps orchestrator.ts untouched. The deck-job
 * dispatcher picks between this and orchestrateDeck based on `mode`.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  chatComplete,
  createTask,
  getTaskResult,
  getTaskStatus,
  openTaskEventStream,
  type BasisEntry,
} from "./parallel_client";
import { parseFirstMarkdownTable } from "./deeper_findings";
import { TEMPLATES } from "../templates/_registry";
import type { OrchestratorEvent, EventSink } from "./orchestrator";
import type {
  AssembledDeck,
  AssembledSlide,
  OrchestratorTemplateId,
  SlideCitation,
} from "../templates/types";

const FORMATTER_MODEL = "claude-sonnet-4-5-20250929";
const FORMATTER_MAX_TURNS = 8;
// Parallel SSE streams stay open ~570s. Ultra-tier runs can exceed
// that, so we reconnect the stream until we see a terminal task_run.state.
const RECONNECT_DELAY_MS = 1500;
// Hard wall-clock cap for the ultra-research phase. If exceeded we bail
// to formatter with whatever the latest result is (or fail gracefully).
const ULTRA_TIMEOUT_MS = 30 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function buildUltraPrompt(topic: string): string {
  return [
    `Produce comprehensive, source-rich research on: '${topic}'.`,
    "",
    "Structure the output so a deck-formatter can carve it into slides afterwards. Include:",
    "",
    "1. **Executive headline** — one sentence capturing the most surprising or load-bearing finding.",
    "2. **5-8 thematic sections**, each:",
    "   - 3-7 word section title",
    "   - 2-4 short paragraphs of analysis with named entities, dates, quantitative claims, and inline `[N]` source references.",
    "   - Where useful, a markdown table comparing players/metrics (4-6 rows × 4-5 cols).",
    "3. **Key stats callouts** — at least 6-8 hard stats with prefix/number/suffix shape ('$24B', '88%', '3.2x', '100M', '40%+'), each tied to a real public source named inline.",
    "4. **Notable timeline** — 5-9 dated events (Q3 2024, Mar 2026, etc.) of the form `MMM YYYY — title — short description`.",
    "5. **Industry/positioning matrix** — a 2-axis comparison (e.g. cost vs control, depth vs breadth) listing 6-10 named players with rough positions.",
    "6. **One pull-quote** — an attributed quote (real, public) from a named operator/analyst.",
    "",
    "**FINAL SECTION (REQUIRED) — `## DEEPER FINDINGS`:**",
    "End your response with a section heading exactly matching `## DEEPER FINDINGS` followed by:",
    "  - A markdown table comparing 4-5 of the most surprising / lesser-known players, frameworks, or data points the prior sections didn't fully cover. Pick 4-5 columns max. Common shapes:",
    "    - { Company | Founded | Funding | Notable Customers | Differentiator }",
    "    - { Tool    | Approach | Strengths | Weaknesses | Best For }",
    "    - { Metric  | 2024 | 2025 | 2026 | Source }",
    "  - 2-3 short paragraphs of analysis below the table — surface niche details, counterintuitive insights, recent (2024-2026) shifts that haven't hit mainstream coverage.",
    "This section is rendered as its own dedicated 'Deeper Findings' slide and MUST contain a parseable markdown table.",
    "",
    "Anchor every claim in a real, recent (2024-2026) public source. Cite as inline `[N]` markers; sources will be tracked separately by the basis system. Skip generic stats everyone knows — surface what makes a domain expert pause.",
  ].join("\n");
}

/**
 * Split out the `## DEEPER FINDINGS` section from the ultra markdown.
 * Returns the remainder (for the formatter) and the section content
 * (for the deeper-findings table slide).
 *
 * Falls back to {rest: full text, deeper: null} if the heading isn't
 * found — the formatter still gets everything, just no separate
 * deeper-findings slide.
 */
function splitDeeperFindings(markdown: string): {
  rest: string;
  deeper: string | null;
} {
  // Match lines like "## DEEPER FINDINGS", case-insensitive, allow extra
  // whitespace / surrounding markdown.
  const re = /^##\s+deeper\s+findings\b[^\n]*$/im;
  const m = markdown.match(re);
  if (!m || m.index == null) return { rest: markdown, deeper: null };
  const before = markdown.slice(0, m.index).trimEnd();
  const after = markdown.slice(m.index + m[0].length).trim();
  if (after.length < 50) return { rest: markdown, deeper: null };
  return { rest: before, deeper: after };
}

/**
 * Parse a deeper-findings slide out of the section text. Returns null
 * if no markdown table found (we don't ship a text-only deeper-findings
 * slide for ultra mode — keep the surface area lean).
 */
function buildDeeperFindingsSlide(
  deeperText: string,
  citations: SlideCitation[],
): AssembledSlide | null {
  // Title from any leading H3, else default
  let title = "Deeper findings";
  let body = deeperText;
  const h3 = deeperText.match(/^###\s+(.+?)\s*$/m);
  if (h3 && h3[1]) {
    title = h3[1].replace(/\*\*/g, "").trim();
    body = deeperText.slice((h3.index ?? 0) + h3[0].length).trim();
  }
  const { table, remaining } = parseFirstMarkdownTable(body);
  if (!table) return null;
  return {
    template_id: "deeper_findings_table",
    focus_hint: "ultra deeper findings",
    content: {
      title,
      columns: table.columns,
      rows: table.rows,
      body: remaining,
    },
    citations,
  };
}

// ===== SSE consumption =====

type ParallelTaskEvent =
  | { type: "task_run.state"; run: { status: string }; output?: { content: string; basis?: BasisEntry[] } }
  | { type: "task_run.progress_msg.exec_status"; message: string; timestamp: string }
  | { type: "task_run.progress_msg.plan"; message: string; timestamp: string }
  | { type: "task_run.progress_msg.tool"; message: string; timestamp: string }
  | {
      type: "task_run.progress_stats";
      source_stats: {
        num_sources_considered: number;
        num_sources_read: number;
        sources_read_sample: string[];
      };
    }
  | { type: "error"; message?: string };

/**
 * Parse one SSE record (`event: foo\ndata: {...}\n\n`) into a JS event.
 */
function parseSseRecord(record: string): ParallelTaskEvent | null {
  const lines = record.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as ParallelTaskEvent;
  } catch {
    return null;
  }
}

/**
 * Open Parallel's SSE event stream for the run, forward events to emit(),
 * reconnect on stream close, and resolve once we see a terminal
 * task_run.state. Returns the markdown content + basis from the final
 * state event.
 */
async function streamUntilTerminal(
  runId: string,
  emit: EventSink,
): Promise<{ content: string; basis: BasisEntry[] }> {
  const t0 = Date.now();
  // Dedupe progress_msg events across reconnects (Parallel re-streams the
  // full reasoning trace on every reconnect).
  const seenMessages = new Set<string>();

  while (true) {
    if (Date.now() - t0 > ULTRA_TIMEOUT_MS) {
      throw new Error(`Ultra stream wall-clock exceeded ${ULTRA_TIMEOUT_MS}ms`);
    }
    let stream: Response;
    try {
      stream = await openTaskEventStream(runId);
    } catch (err) {
      // Connection failed — log and check status before retrying
      // eslint-disable-next-line no-console
      console.warn(`[ultra_deck] stream open failed:`, err);
      const status = await getTaskStatus(runId).catch(() => null);
      if (status?.status === "completed") {
        // Race: stream failed but task is done. Fetch result directly.
        const result = await getTaskResult<string>(runId);
        return {
          content: typeof result.output?.content === "string" ? result.output.content : "",
          basis: result.output?.basis || result.basis || [],
        };
      }
      if (status?.status === "failed" || status?.status === "cancelled") {
        throw new Error(`Ultra ${status.status}: ${status.error?.message || ""}`);
      }
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      continue;
    }
    if (!stream.body) {
      throw new Error("Ultra stream returned no body");
    }
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalContent: string | null = null;
    let terminalBasis: BasisEntry[] = [];
    let streamEnded = false;

    while (!streamEnded) {
      const { value, done } = await reader.read();
      if (done) {
        streamEnded = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split("\n\n");
      buffer = records.pop() || "";
      for (const record of records) {
        const evt = parseSseRecord(record);
        if (!evt) continue;
        if (evt.type === "task_run.state") {
          const status = evt.run?.status;
          if (status === "completed" && evt.output) {
            terminalContent =
              typeof evt.output.content === "string" ? evt.output.content : "";
            terminalBasis = evt.output.basis || [];
            streamEnded = true;
            break;
          }
          if (status === "failed" || status === "cancelled") {
            throw new Error(`Ultra ${status}`);
          }
          continue;
        }
        if (
          evt.type === "task_run.progress_msg.exec_status" ||
          evt.type === "task_run.progress_msg.plan" ||
          evt.type === "task_run.progress_msg.tool"
        ) {
          // Dedupe across reconnects
          const key = evt.type + "|" + (evt.message || "");
          if (seenMessages.has(key)) continue;
          seenMessages.add(key);
          const kind: "exec_status" | "plan" | "tool" =
            evt.type === "task_run.progress_msg.exec_status"
              ? "exec_status"
              : evt.type === "task_run.progress_msg.plan"
                ? "plan"
                : "tool";
          emit({
            type: "parallel_message",
            kind,
            message: evt.message,
            ts: nowIso(),
          });
          continue;
        }
        if (evt.type === "task_run.progress_stats") {
          emit({
            type: "parallel_sources",
            considered: evt.source_stats.num_sources_considered,
            read: evt.source_stats.num_sources_read,
            sample_urls: evt.source_stats.sources_read_sample || [],
            ts: nowIso(),
          });
          continue;
        }
        if (evt.type === "error") {
          throw new Error(`Ultra stream error: ${evt.message || "(no detail)"}`);
        }
      }
    }

    if (terminalContent !== null) {
      return { content: terminalContent, basis: terminalBasis };
    }
    // Stream closed without terminal — check status, reconnect if still running
    const status = await getTaskStatus(runId).catch(() => null);
    if (status?.status === "completed") {
      const result = await getTaskResult<string>(runId);
      return {
        content: typeof result.output?.content === "string" ? result.output.content : "",
        basis: result.output?.basis || result.basis || [],
      };
    }
    if (status?.status === "failed" || status?.status === "cancelled") {
      throw new Error(`Ultra ${status.status}: ${status.error?.message || ""}`);
    }
    // Still running — reconnect after a short delay
    // eslint-disable-next-line no-console
    console.log(`[ultra_deck] stream closed mid-run (${runId}); reconnecting`);
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
}

// ===== Formatter =====

function flattenBasis(basis: BasisEntry[]): SlideCitation[] {
  const seen = new Set<string>();
  const out: SlideCitation[] = [];
  for (const entry of basis) {
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

const FORMATTER_TEMPLATES: OrchestratorTemplateId[] = [
  "cover",
  "summary",
  "divider",
  "timeline",
  "brief",
  "callout",
  "matrix",
  "quote",
];

function buildFormatterTools(): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  for (const id of FORMATTER_TEMPLATES) {
    const tpl = TEMPLATES[id];
    const schema = tpl.schema as Record<string, unknown>;
    const props = (schema.properties || {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    tools.push({
      name: `add_${id}`,
      description: `Add a ${id} slide to the deck. focus_hint is a short label naming the angle.`,
      input_schema: {
        type: "object",
        required: ["focus_hint", ...required],
        properties: {
          focus_hint: { type: "string" },
          ...props,
        },
      },
    });
  }
  return tools;
}

const FORMATTER_SYSTEM = `You are the FORMATTER for a Parallel ultra-tier research run.

Parallel's ultra-tier processor produced a long markdown research document on the topic. Your job: carve it into a 7-12 slide deck using the available templates.

Rules:
1. Use ONLY the add_* tools below — one tool call per slide. No prose narration.
2. ALWAYS include cover (slide 1) and quote. Pick 5-10 more from {summary, divider, timeline, brief, callout, matrix}; you may use a template more than once with different focus_hints (e.g. two callouts for different stat clusters).
3. Total slide count: 7-12.
4. The quote slide MUST use a real, attributed quote from the research — if the research doesn't include one, skip the quote slide rather than fabricate.
5. For each slide, populate the schema fields directly from facts in the research. Preserve named entities, dates, dollar amounts, percentages, multipliers exactly as written.
6. Use **double-asterisk** markers in any prose field (general_approach, desc, etc.) to bold key entities/numbers — these render as inline bold.
7. Issue ALL slide tool calls in a SINGLE assistant turn (parallel tool_use blocks) so the deck is built in one pass.

If the research includes a 2-axis comparison, use \`add_matrix\` for a positioning view. Standout stats go into \`add_callout\`. NOTE: any "Deeper Findings" section the research ends with is extracted automatically and rendered as a separate table slide — do NOT try to fold that section into your slides; just build the rest of the deck.

Do not invent data. Every claim must trace to the research document.`;

async function formatIntoDeck(
  topic: string,
  markdown: string,
  basis: BasisEntry[],
  emit: EventSink,
): Promise<AssembledDeck> {
  emit({ type: "phase", name: "ultra_formatting", ts: nowIso() });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set; ultra formatter cannot run");
  }
  const client = new Anthropic({ apiKey });
  const tools = buildFormatterTools();
  const allCitations = flattenBasis(basis);

  const userMessage = [
    `Topic: ${topic}`,
    "",
    "Ultra-tier research output:",
    "```",
    markdown,
    "```",
    "",
    "Carve this into a 7-12 slide deck. Issue all add_* tool calls in one assistant turn.",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const slides: AssembledSlide[] = [];

  for (let turn = 0; turn < FORMATTER_MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: FORMATTER_MODEL,
      max_tokens: 16000,
      system: FORMATTER_SYSTEM,
      tools,
      messages,
    });

    for (const blk of resp.content) {
      if (blk.type === "text" && blk.text.trim()) {
        emit({ type: "claude_text", text: blk.text.trim(), ts: nowIso() });
      }
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: resp.content });

    for (const tu of toolUses) {
      const m = /^add_(.+)$/.exec(tu.name);
      if (!m || !m[1]) continue;
      const template_id = m[1] as OrchestratorTemplateId;
      if (!FORMATTER_TEMPLATES.includes(template_id)) continue;
      const input = tu.input as Record<string, unknown>;
      const focus_hint = String(input.focus_hint || "");
      const { focus_hint: _drop, ...content } = input;
      slides.push({
        template_id,
        focus_hint,
        content: content as Record<string, unknown>,
        // Same citations attached to every slide — formatter doesn't have
        // per-slide basis from the single Task call, so we share the deck-
        // wide pool. Appendix dedupe will handle the rest.
        citations: allCitations,
      });
      emit({
        type: "tool_result",
        tool_use_id: tu.id,
        name: tu.name,
        template_id,
        success: true,
        ts: nowIso(),
      });
    }

    messages.push({
      role: "user",
      content: toolUses.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: "ok",
      })),
    });

    if (resp.stop_reason === "end_turn") break;
  }

  // Synthesize the appendix from collected basis (same as orchestrator path)
  const appendixSlide = synthesizeAppendix(slides, allCitations);
  if (appendixSlide) slides.push(appendixSlide);

  return { topic, slides };
}

function synthesizeAppendix(
  slides: AssembledSlide[],
  fallback: SlideCitation[],
): AssembledSlide | null {
  const seen = new Set<string>();
  const collected: Array<{
    title: string;
    url: string;
    publication?: string;
    confidence?: "high" | "medium" | "low";
  }> = [];
  const all = [...fallback, ...slides.flatMap((s) => s.citations)];
  for (const c of all) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    let publication: string | undefined;
    try {
      publication = new URL(c.url).hostname.replace(/^www\./, "");
    } catch {
      publication = undefined;
    }
    collected.push({
      title: c.title || publication || c.url,
      url: c.url,
      publication,
      confidence: c.confidence,
    });
  }
  if (collected.length < 3) return null;
  const score = (c: (typeof collected)[number]): number => {
    const conf =
      c.confidence === "high" ? 3 : c.confidence === "medium" ? 2 : 1;
    return conf * 1000 + (c.title?.length || 0);
  };
  collected.sort((a, b) => score(b) - score(a));
  const top = collected.slice(0, 14);
  return {
    template_id: "appendix",
    focus_hint: "auto-generated",
    content: {
      citations: top.map((c) => ({
        title: c.title,
        url: c.url,
        ...(c.publication ? { publication: c.publication } : {}),
      })),
    },
    citations: top.map((c) => ({
      url: c.url,
      title: c.title,
      excerpts: [],
      confidence: c.confidence,
    })),
  };
}

// ===== Per-slide refine pass =====
// After the formatter assembles slides from the ultra markdown, kick off
// ONE Parallel Chat API "core" interaction per slide to refine its
// content. This is the hybrid step: ultra gives breadth in one shot,
// per-slide refines tighten the depth/flow/sourcing slide-by-slide.
//
// One interaction per slide, all in parallel. Failures fall back to the
// formatter's content silently (we never block the deck on refinement).

const REFINE_MODEL = "core" as const;

function buildRefinePrompt(
  template_id: OrchestratorTemplateId,
  topic: string,
  ultraMarkdown: string,
  currentContent: Record<string, unknown>,
): string {
  return [
    `You are refining ONE slide in a research deck on: '${topic}'.`,
    "",
    `Slide template: ${template_id}.`,
    "",
    "The current slide content was extracted from a broader ultra-tier research document. Your job is to TIGHTEN it: improve the research depth, the flow of explanation, the specificity of named entities/numbers/dates, and the inline source citations. Stay within the same schema.",
    "",
    "Rules:",
    "1. Preserve all CORRECT existing facts. Refine, don't rewrite.",
    "2. Where the current content is generic, push for a specific named entity/number/year.",
    "3. Where the current content cites a single source, look for cross-validation.",
    "4. Honor every schema field's length cap — overlong text overflows the layout.",
    "5. If the current content is already strong, return it largely as-is.",
    "",
    "=== CURRENT SLIDE CONTENT (JSON) ===",
    JSON.stringify(currentContent, null, 2),
    "",
    "=== ORIGINAL ULTRA RESEARCH (for context) ===",
    ultraMarkdown.slice(0, 8000),
    "",
    "Return refined content matching the schema.",
  ].join("\n");
}

/**
 * Run one Chat API refinement call for a slide. Returns the refined
 * content if it parsed cleanly; null on any failure (caller keeps the
 * pre-refine content). Citations are merged from the new basis.
 */
async function refineOneSlide(
  slide: AssembledSlide,
  topic: string,
  ultraMarkdown: string,
): Promise<{ content: Record<string, unknown>; citations: SlideCitation[] } | null> {
  if (slide.template_id !== "summary" &&
      slide.template_id !== "divider" &&
      slide.template_id !== "timeline" &&
      slide.template_id !== "brief" &&
      slide.template_id !== "callout" &&
      slide.template_id !== "matrix") {
    // Skip cover/quote/appendix/deeper_findings — their schemas are
    // either fixed (cover/appendix) or immutable (quote) or absent.
    return null;
  }
  const tpl = TEMPLATES[slide.template_id];
  try {
    const resp = await chatComplete({
      model: REFINE_MODEL,
      messages: [
        {
          role: "user",
          content: buildRefinePrompt(
            slide.template_id,
            topic,
            ultraMarkdown,
            slide.content,
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: slide.template_id, schema: tpl.schema },
      },
    });
    const raw = resp.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const newCitations = flattenBasis(resp.basis || []);
    // Merge: prefer new citations, fall back to old if empty
    const citations = newCitations.length > 0 ? newCitations : slide.citations;
    return { content: parsed, citations };
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ultra_deck] refine failed for ${slide.template_id}/${slide.focus_hint}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Run all per-slide refinements in parallel. Returns a new deck with
 * refined content where the call succeeded, original content otherwise.
 */
async function refineAllSlides(
  deck: AssembledDeck,
  ultraMarkdown: string,
  emit: EventSink,
): Promise<AssembledDeck> {
  emit({ type: "phase", name: "ultra_formatting", ts: nowIso() });
  // eslint-disable-next-line no-console
  console.log(
    `[ultra_deck] refining ${deck.slides.length} slides via per-slide Chat API core calls`,
  );
  const t0 = Date.now();
  const refined = await Promise.allSettled(
    deck.slides.map((s) => refineOneSlide(s, deck.topic, ultraMarkdown)),
  );
  let refinedCount = 0;
  const newSlides: AssembledSlide[] = deck.slides.map((s, i) => {
    const r = refined[i];
    if (r && r.status === "fulfilled" && r.value) {
      refinedCount++;
      return {
        ...s,
        content: r.value.content,
        citations: r.value.citations,
      };
    }
    return s;
  });
  // eslint-disable-next-line no-console
  console.log(
    `[ultra_deck] refined ${refinedCount}/${deck.slides.length} slides in ${
      ((Date.now() - t0) / 1000).toFixed(1)
    }s`,
  );
  return { ...deck, slides: newSlides };
}

// ===== Main entry =====

export async function runUltraDeck(
  topic: string,
  emit: EventSink,
): Promise<AssembledDeck> {
  emit({ type: "started", topic, ts: nowIso() });
  emit({ type: "phase", name: "ultra_research", ts: nowIso() });

  // Tunable: swap to "ultra4x" / "ultra8x" to dial up depth at the cost
  // of latency. Mode key on the API surface stays "ultra" so this swap
  // doesn't churn frontend types or persisted job records.
  const PROCESSOR_TIER = "ultra2x" as const;
  // eslint-disable-next-line no-console
  console.log(`[ultra_deck] creating ${PROCESSOR_TIER} task for "${topic}"`);
  const created = await createTask({
    processor: PROCESSOR_TIER,
    task_spec: { output_schema: { type: "text" } },
    input: buildUltraPrompt(topic),
    enable_events: true,
  });
  // eslint-disable-next-line no-console
  console.log(`[ultra_deck] run_id=${created.run_id}`);

  const t0 = Date.now();
  const { content, basis } = await streamUntilTerminal(created.run_id, emit);
  // eslint-disable-next-line no-console
  console.log(
    `[ultra_deck] research complete in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${content.length} chars, ${basis.length} basis entries`,
  );

  if (!content || content.length < 200) {
    throw new Error("Ultra returned empty or too-short research output");
  }

  // Split off the `## DEEPER FINDINGS` section — the formatter gets the
  // rest for slide assembly, the deeper section becomes its own table
  // slide via the same shape the orchestrator's pro-fast pass produces.
  const { rest: forFormatter, deeper } = splitDeeperFindings(content);

  const formatted = await formatIntoDeck(topic, forFormatter, basis, emit);
  // eslint-disable-next-line no-console
  console.log(`[ultra_deck] deck formatted — ${formatted.slides.length} slides`);

  // Hybrid refinement pass — one Chat API "core" interaction per editable
  // slide to tighten depth/flow/sourcing. All in parallel; failures
  // silently keep the formatter's content.
  let deck = await refineAllSlides(formatted, content, emit);

  // Append deeper-findings table slide if the ultra response included
  // a parseable markdown table in the DEEPER FINDINGS section.
  if (deeper) {
    const allCitations = flattenBasis(basis);
    const deeperSlide = buildDeeperFindingsSlide(deeper, allCitations);
    if (deeperSlide) {
      deck = { ...deck, slides: [...deck.slides, deeperSlide] };
      // eslint-disable-next-line no-console
      console.log(
        `[ultra_deck] appended deeper_findings_table slide from ultra DEEPER FINDINGS section`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[ultra_deck] DEEPER FINDINGS section had no parseable table — skipped`,
      );
    }
  }

  emit({ type: "deck_assembled", deck, ts: nowIso() });
  return deck;
}
