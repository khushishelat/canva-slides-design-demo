/**
 * Claude-as-orchestrator deck generator.
 *
 * Pattern (validated by /tmp/orchestrator-proto-v2 prototype):
 *   1. Initial+reactive phase: Claude fires research_slide + quote_hunt in
 *      parallel (one assistant turn with multiple tool_use blocks). After
 *      results return it inspects each slide and may fire follow-ups.
 *   2. Cross-slide phase: a separate user message asks Claude to look across
 *      all slides for surprising/contradictory threads and fire 1-3 final
 *      follow-ups via previous_interaction_id.
 *   3. Assembly: final assistant message contains a fenced JSON block with
 *      the slide order + interaction_ids per slide.
 *
 * The orchestrator emits events to a sink as it works (turn started,
 * tool_use fired, tool_result received, phase changed, deck_assembled,
 * etc.) so the deck job manager can persist + replay them via SSE.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  followUpSlide,
  quoteHunt,
  researchSlide,
  TOOL_DEFS,
  type WorkerResult,
} from "./orchestrator_tools";
import type {
  AssembledDeck,
  AssembledSlide,
  OrchestratorTemplateId,
  SlideCitation,
  TemplateId,
} from "../templates/types";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TURNS = 10;

const SYSTEM_PROMPT = `You are an orchestrator producing a Parallel-branded research deck.

You assemble a 7-12 slide deck on a given topic by delegating each slide to a
Parallel \`core\` research subagent. You research 8 templates: cover, summary,
divider, timeline, brief, callout, matrix, quote.

The appendix slide is auto-generated from the union of citations collected
across the other slides — DO NOT call research_slide on appendix. Do not
include it in your final fenced JSON either; it will be appended automatically.

## Treat each slide as a thread to pull.

Fire follow-ups when:
- A field reads generically ("companies are adopting AI" -> push for a specific
  stat with year and named actor).
- A worker surfaces a claim that's interesting but undersourced (one source on
  a big claim -> ask for cross-validation from a different publisher).
- Sources cluster on one publisher (3 cites all from Gartner -> ask for a
  non-Gartner perspective from McKinsey, IDC, Stanford HAI, BloombergNEF, IEA,
  IQVIA, Evaluate, FT, Reuters, etc.).
- A field references something more specific than the worker captured
  ("BYD overtook Tesla" -> "what was the exact volume gap, in which quarter?").

You may fire up to 5 follow-ups per slide. Up to 15 total across the deck.
Prefer firing a follow-up over leaving a thin or generic field. The user values
depth over speed.

## Hard rules

1. ALWAYS include \`cover\` and \`quote\`. Pick 5-10 more from
   {summary, divider, timeline, brief, callout, matrix} (you may use a template
   more than once with different focus_hints, e.g. two callouts for different
   stat clusters). Total 7-12 slides researched. (Appendix is appended later
   from collected citations — do not research it.)
2. The \`quote\` slide is REQUIRED. Use the \`quote_hunt\` tool for it (NOT
   \`research_slide\`).
3. NEVER call \`follow_up_slide\` with template_id="quote". Quote slides are
   immutable. If a quote raises a factual question, fire a fresh
   \`research_slide\` call on a callout/brief/timeline to investigate instead.
4. In your FIRST turn, fire ALL initial research_slide + quote_hunt calls in
   PARALLEL — emit multiple tool_use blocks in a single assistant message.
5. After results come back, INSPECT every slide. Use thinness_signals
   (citations_count, unique_domain_count, empty_required_fields, short_excerpts,
   unique_publication_count) AND read the actual content for genericity. Fire
   follow-ups freely within the per-slide and total budgets.
6. After your initial + reactive follow-up turns, a separate user message will
   ask you to do a CROSS-SLIDE THREAD-PULL pass. In that pass, look across all
   slides for surprising/counterintuitive facts, claims one slide makes that
   another could deepen, or stats that beg a "but why" follow-up. Fire 1-3
   final follow_ups (chained via previous_interaction_id) targeting any slide
   except quote.
7. When the cross-slide pass is also done, output ONE final assistant message
   containing a fenced JSON block:

\`\`\`json
{"topic": "...", "slides": [{"template_id": "cover", "focus_hint": "...", "interaction_id": "..."}, ...]}
\`\`\`

The slides array must be in deck order. Reference the latest interaction_id
(post-followup if any) per slide. For the quote slide, use the interaction_id
returned by the winning quote_hunt attempt.`;

// ===== Event types emitted to the sink =====

export type OrchestratorEvent =
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
      thinness_signals?: WorkerResult["thinness_signals"];
      error?: string;
      ts: string;
    }
  | {
      // Forwarded from Parallel's SSE stream (ultra8x mode). The model's
      // top-level reasoning trace — surfaced in the live ticker.
      type: "parallel_message";
      kind: "exec_status" | "plan" | "tool";
      message: string;
      ts: string;
    }
  | {
      // Forwarded from Parallel's progress_stats — used by the frontend
      // to render a favicon strip of sources discovered.
      type: "parallel_sources";
      considered: number;
      read: number;
      sample_urls: string[];
      ts: string;
    }
  | { type: "deck_assembled"; deck: AssembledDeck; ts: string }
  | { type: "failed"; error: string; ts: string };

export type EventSink = (evt: OrchestratorEvent) => void;

// ===== Track the latest interaction_id + result per slide =====
// Keyed by `${template_id}#${focus_hint}` so the same template at different
// focuses doesn't collide.

type SlideKey = string;

function slideKey(template_id: TemplateId, focus_hint: string): SlideKey {
  return `${template_id}#${focus_hint}`;
}

type SlideState = {
  template_id: TemplateId;
  focus_hint: string;
  content: Record<string, unknown> | null;
  citations: SlideCitation[];
  interaction_id?: string;
  // first interaction_id ever (so follow-ups can reference back to a stable id)
  first_interaction_id?: string;
};

// ===== Main entry =====

export async function orchestrateDeck(
  topic: string,
  emit: EventSink,
): Promise<AssembledDeck> {
  emit({ type: "started", topic, ts: nowIso() });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err =
      "ANTHROPIC_API_KEY is not set. Add it to .env (e.g. ANTHROPIC_API_KEY=\"sk-ant-...\").";
    emit({ type: "failed", error: err, ts: nowIso() });
    throw new Error(err);
  }
  const client = new Anthropic({ apiKey });

  const slides = new Map<SlideKey, SlideState>();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Topic: ${topic}\n\nProduce a 7-12 slide research deck following all hard rules. Begin with the initial fan-out.`,
    },
  ];

  let totalFollowUps = 0;
  const followUpsBySlide = new Map<TemplateId, number>();

  // ---------- Phase 1: initial + reactive ----------
  // eslint-disable-next-line no-console
  console.log(`[orchestrator] phase 1 (initial + reactive) for "${topic}"`);
  emit({ type: "phase", name: "initial_and_reactive", ts: nowIso() });
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFS,
      messages,
    });
    // Echo Claude's text blocks for the live ticker
    for (const blk of resp.content) {
      if (blk.type === "text") {
        emit({ type: "claude_text", text: blk.text, ts: nowIso() });
      }
    }
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // No tool calls + end_turn means Phase 1 is done
    if (resp.stop_reason === "end_turn" && toolUses.length === 0) {
      messages.push({ role: "assistant", content: resp.content });
      break;
    }
    messages.push({ role: "assistant", content: resp.content });

    // Run all tool calls in parallel
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        emit({
          type: "tool_use",
          tool_use_id: tu.id,
          name: tu.name,
          input: tu.input as Record<string, unknown>,
          ts: nowIso(),
        });
        return runTool(tu, slides, followUpsBySlide).then((res) => {
          emit(makeToolResultEvent(tu, res));
          if (tu.name === "follow_up_slide") totalFollowUps++;
          return { tu, res };
        });
      }),
    );

    // Stop early if we've hit the deck-wide follow-up budget
    if (totalFollowUps >= 15) {
      // eslint-disable-next-line no-console
      console.log("[orchestrator] hit deck-wide follow-up budget; advancing to cross-slide phase");
    }

    messages.push({
      role: "user",
      content: toolResults.map(({ tu, res }) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: JSON.stringify(toResultPayload(res)),
      })),
    });

    if (resp.stop_reason === "end_turn") break;
  }

  // ---------- Phase 2: cross-slide thread-pull ----------
  // eslint-disable-next-line no-console
  console.log(
    `[orchestrator] phase 2 (cross-slide) — slides ready: ${
      Array.from(slides.values()).filter((s) => s.content).length
    }/${slides.size}, follow-ups fired: ${totalFollowUps}`,
  );
  emit({ type: "phase", name: "cross_slide", ts: nowIso() });
  messages.push({
    role: "user",
    content:
      "Now do the CROSS-SLIDE THREAD-PULL pass. Read all slides together. " +
      "Fire 1-3 final follow_up_slide calls (NEVER on quote) targeting " +
      "surprising contradictions, claims one slide could deepen, or stats " +
      "that beg a 'but why' follow-up. After those return, output the final " +
      "fenced JSON block with the deck plan.",
  });

  for (let turn = 0; turn < 5; turn++) {
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFS,
      messages,
    });
    for (const blk of resp.content) {
      if (blk.type === "text") {
        emit({ type: "claude_text", text: blk.text, ts: nowIso() });
      }
    }
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: resp.content });
    if (resp.stop_reason === "end_turn" && toolUses.length === 0) break;
    if (toolUses.length === 0) break;
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        emit({
          type: "tool_use",
          tool_use_id: tu.id,
          name: tu.name,
          input: tu.input as Record<string, unknown>,
          ts: nowIso(),
        });
        return runTool(tu, slides, followUpsBySlide).then((res) => {
          emit(makeToolResultEvent(tu, res));
          return { tu, res };
        });
      }),
    );
    messages.push({
      role: "user",
      content: toolResults.map(({ tu, res }) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: JSON.stringify(toResultPayload(res)),
      })),
    });
    if (resp.stop_reason === "end_turn") break;
  }

  // ---------- Phase 3: assembly from final fenced JSON ----------
  // eslint-disable-next-line no-console
  console.log(`[orchestrator] phase 3 (assembly)`);
  emit({ type: "phase", name: "assembly", ts: nowIso() });
  const finalText = lastAssistantText(messages);
  const planJson = extractFencedJson(finalText);
  let deck: AssembledDeck;

  /**
   * Resolve a slide reference from the final JSON to a slide we actually
   * researched. Match strategies, in order:
   *   1. interaction_id (if Claude included it and it's accurate)
   *   2. exact (template_id + focus_hint) — only works if Claude restated
   *      focus_hint byte-perfect, which it often doesn't
   *   3. template_id alone, picking the first unmatched slide of that
   *      template — handles paraphrased focus_hints
   * `usedKeys` tracks which entries in `slides` we've already claimed so
   * the same researched slide doesn't get used twice.
   */
  function resolveRef(
    ref: { template_id: TemplateId; focus_hint?: string; interaction_id?: string },
    usedKeys: Set<string>,
  ): { key: string; state: SlideState } | null {
    // 1. interaction_id
    if (ref.interaction_id) {
      for (const [key, s] of slides.entries()) {
        if (usedKeys.has(key)) continue;
        if (
          s.interaction_id === ref.interaction_id ||
          s.first_interaction_id === ref.interaction_id
        ) {
          return { key, state: s };
        }
      }
    }
    // 2. exact match
    if (ref.focus_hint) {
      const key = slideKey(ref.template_id, ref.focus_hint);
      const s = slides.get(key);
      if (s && !usedKeys.has(key)) return { key, state: s };
    }
    // 3. template_id loose match
    for (const [key, s] of slides.entries()) {
      if (usedKeys.has(key)) continue;
      if (s.template_id === ref.template_id) return { key, state: s };
    }
    return null;
  }

  if (planJson && Array.isArray(planJson.slides)) {
    const resolvedSlides: AssembledSlide[] = [];
    const usedKeys = new Set<string>();
    let exact = 0;
    let loose = 0;
    let unmatched = 0;
    for (const ref of planJson.slides as Array<{
      template_id: TemplateId;
      focus_hint?: string;
      interaction_id?: string;
    }>) {
      const r = resolveRef(ref, usedKeys);
      if (!r) {
        unmatched++;
        continue;
      }
      if (r.state.focus_hint === ref.focus_hint) exact++;
      else loose++;
      if (r.state.content) {
        resolvedSlides.push({
          template_id: r.state.template_id,
          focus_hint: r.state.focus_hint,
          content: r.state.content,
          citations: r.state.citations,
          interaction_id: r.state.interaction_id,
        });
        usedKeys.add(r.key);
      }
    }
    // Don't lose work: append any researched slides Claude forgot to
    // reference in the final JSON.
    let appended = 0;
    for (const [key, s] of slides.entries()) {
      if (usedKeys.has(key) || !s.content) continue;
      resolvedSlides.push({
        template_id: s.template_id,
        focus_hint: s.focus_hint,
        content: s.content,
        citations: s.citations,
        interaction_id: s.interaction_id,
      });
      appended++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[orchestrator] assembly matches: ${exact} exact, ${loose} loose, ${unmatched} unmatched-from-json, +${appended} appended`,
    );
    deck = { topic, slides: resolvedSlides };
  } else {
    // No fenced JSON at all — assemble in insertion order from the map
    // eslint-disable-next-line no-console
    console.log(`[orchestrator] assembly: no fenced JSON, falling back to insertion order`);
    deck = {
      topic,
      slides: Array.from(slides.values())
        .filter((s) => s.content !== null)
        .map((s) => ({
          template_id: s.template_id,
          focus_hint: s.focus_hint,
          content: s.content as Record<string, unknown>,
          citations: s.citations,
          interaction_id: s.interaction_id,
        })),
    };
  }

  // ---------- Phase 4: synthesize appendix from collected citations ----------
  // No second API call — every body slide already has citations attached
  // via Parallel's `basis`. We dedupe by URL, prefer entries that have
  // titles + publications + dates, and keep up to 14.
  const appendixSlide = synthesizeAppendix(deck.slides);
  if (appendixSlide) {
    deck = { ...deck, slides: [...deck.slides, appendixSlide] };
  }

  // eslint-disable-next-line no-console
  console.log(
    `[orchestrator] deck assembled — ${deck.slides.length} slides, ${
      new Set(deck.slides.flatMap((s) => s.citations.map((c) => c.url))).size
    } unique sources`,
  );
  emit({ type: "deck_assembled", deck, ts: nowIso() });
  return deck;
}

/**
 * Build the appendix slide by deduping all per-slide citations across
 * the deck. Returns null if the deck has fewer than 3 unique sources
 * (in which case shipping an appendix would be embarrassing).
 *
 * Selection: dedupe by URL, prefer entries with `title`, `field` paired
 * with high-confidence basis. Cap at 14 to fit the appendix layout.
 */
function synthesizeAppendix(slides: AssembledSlide[]): AssembledSlide | null {
  const seen = new Set<string>();
  const collected: Array<{
    title: string;
    url: string;
    publication?: string;
    confidence?: "high" | "medium" | "low";
  }> = [];
  for (const slide of slides) {
    for (const c of slide.citations) {
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
  }
  if (collected.length < 3) return null;

  // Rank: high confidence first, then by title length (proxy for richness)
  const score = (c: (typeof collected)[number]): number => {
    const conf =
      c.confidence === "high" ? 3 : c.confidence === "medium" ? 2 : 1;
    return conf * 1000 + (c.title?.length || 0);
  };
  collected.sort((a, b) => score(b) - score(a));
  const top = collected.slice(0, 14);

  return {
    template_id: "appendix",
    focus_hint: "auto-generated from deck citations",
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

// ===== Helpers =====

async function runTool(
  tu: Anthropic.ToolUseBlock,
  slides: Map<SlideKey, SlideState>,
  followUpsBySlide: Map<TemplateId, number>,
): Promise<WorkerResult & { attempts?: number }> {
  const input = tu.input as Record<string, unknown>;
  if (tu.name === "research_slide") {
    const args = {
      template_id: input.template_id as OrchestratorTemplateId,
      topic: input.topic as string,
      focus_hint: input.focus_hint as string,
    };
    const res = await researchSlide(args);
    if (res.content) {
      slides.set(slideKey(args.template_id, args.focus_hint), {
        template_id: args.template_id,
        focus_hint: args.focus_hint,
        content: res.content,
        citations: res.citations,
        interaction_id: res.interaction_id,
        first_interaction_id: res.interaction_id,
      });
    }
    return res;
  }
  if (tu.name === "follow_up_slide") {
    const args = {
      template_id: input.template_id as OrchestratorTemplateId,
      interaction_id: input.interaction_id as string,
      instruction: input.instruction as string,
    };
    // Enforce per-slide cap of 5 follow-ups
    const used = followUpsBySlide.get(args.template_id) || 0;
    if (used >= 5) {
      return {
        template_id: args.template_id,
        content: null,
        citations: [],
        thinness_signals: {
          citations_count: 0,
          unique_domain_count: 0,
          unique_publication_count: 0,
          empty_required_fields: [],
          short_excerpts: 0,
        },
        error: `per-slide follow-up budget exhausted for ${args.template_id} (5/5)`,
      };
    }
    followUpsBySlide.set(args.template_id, used + 1);
    const res = await followUpSlide(args);
    if (res.content) {
      // Find the matching slide-state (by interaction_id) and update it
      for (const [key, s] of slides.entries()) {
        if (
          s.interaction_id === args.interaction_id ||
          s.first_interaction_id === args.interaction_id
        ) {
          slides.set(key, {
            ...s,
            content: res.content,
            citations: mergeCitations(s.citations, res.citations),
            interaction_id: res.interaction_id,
          });
          break;
        }
      }
    }
    return res;
  }
  if (tu.name === "quote_hunt") {
    const args = {
      topic: input.topic as string,
      focus_hint: input.focus_hint as string,
      persona_hint: input.persona_hint as string | undefined,
    };
    const res = await quoteHunt(args);
    if (res.content) {
      slides.set(slideKey("quote", args.focus_hint), {
        template_id: "quote",
        focus_hint: args.focus_hint,
        content: res.content,
        citations: res.citations,
        interaction_id: res.interaction_id,
        first_interaction_id: res.interaction_id,
      });
    }
    return res;
  }
  return {
    template_id: "cover",
    content: null,
    citations: [],
    thinness_signals: {
      citations_count: 0,
      unique_domain_count: 0,
      unique_publication_count: 0,
      empty_required_fields: [],
      short_excerpts: 0,
    },
    error: `unknown tool: ${tu.name}`,
  };
}

function makeToolResultEvent(
  tu: Anthropic.ToolUseBlock,
  res: WorkerResult,
): OrchestratorEvent {
  return {
    type: "tool_result",
    tool_use_id: tu.id,
    name: tu.name,
    template_id: res.template_id,
    success: !res.error && res.content !== null,
    content: res.content,
    citations: res.citations,
    interaction_id: res.interaction_id,
    thinness_signals: res.thinness_signals,
    error: res.error,
    ts: nowIso(),
  };
}

function toResultPayload(res: WorkerResult & { attempts?: number }) {
  return {
    template_id: res.template_id,
    content: res.content,
    interaction_id: res.interaction_id,
    thinness_signals: res.thinness_signals,
    attempts: res.attempts,
    citations_summary: {
      count: res.citations.length,
      domains: Array.from(
        new Set(
          res.citations
            .map((c) => {
              try {
                return new URL(c.url).hostname.replace(/^www\./, "");
              } catch {
                return null;
              }
            })
            .filter((d): d is string => !!d),
        ),
      ),
    },
    error: res.error,
  };
}

function mergeCitations(a: SlideCitation[], b: SlideCitation[]): SlideCitation[] {
  const seen = new Set<string>();
  const out: SlideCitation[] = [];
  for (const c of [...a, ...b]) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

function lastAssistantText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const texts = m.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (texts) return texts;
    }
  }
  return "";
}

function extractFencedJson(text: string): { topic?: string; slides?: unknown } | null {
  // Match ```json ... ``` or ``` ... ``` with first JSON object
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (!fence || !fence[1]) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
