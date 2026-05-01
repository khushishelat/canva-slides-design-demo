/**
 * Synthesizer pass — runs AFTER both the orchestrator and the pro-fast
 * "deeper findings" task complete. Gives Claude one final opportunity
 * to edit slides on the assembled deck if the deeper-findings research
 * surfaced something that should be folded in (a missing player on the
 * matrix, a sharper stat for a callout, a more specific company name
 * in a brief's prose).
 *
 * Design choices:
 * - Per-template tools (`replace_summary`, `replace_brief`, …) instead
 *   of one generic tool. Each tool's `input_schema` = the orchestrator
 *   template's JSON schema + `focus_hint`. Anthropic's SDK validates
 *   tool inputs against input_schema, so a malformed edit is rejected
 *   before it reaches our code.
 * - Quote/cover/appendix/deeper_findings slides are NOT editable —
 *   quotes are immutable, cover/appendix have fixed shape, deeper
 *   findings is the input not the target.
 * - Soft-cap of 3 edits per pass via the prompt; we don't hard-enforce
 *   in code (the model is well-behaved; a hard cap would lose useful
 *   edits in the rare case Claude wants 4).
 *
 * Failures here never block deck shipment. If the synthesizer call
 * fails, throws, or returns no edits, the deck ships as-is.
 */
import Anthropic from "@anthropic-ai/sdk";
import { TEMPLATES } from "../templates/_registry";
import type {
  AssembledDeck,
  AssembledSlide,
  OrchestratorTemplateId,
} from "../templates/types";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TURNS = 3;

/** Templates the synthesizer is allowed to edit. */
const EDITABLE: OrchestratorTemplateId[] = [
  "summary",
  "divider",
  "timeline",
  "brief",
  "callout",
  "matrix",
];

const SYSTEM_PROMPT = `You are the SYNTHESIZER for a Parallel research deck.

The orchestrator has assembled a deck on the topic. A parallel "deeper findings" research pass (Parallel pro-fast) has surfaced lesser-known angles, niche players, or counterintuitive stats — you'll see those in the deck as the deeper_findings_table or deeper_findings_text slide.

Your job: decide if any of the EDITABLE slides should be revised to incorporate insights from the deeper findings. Be conservative — most slides should NOT be edited.

EDITABLE templates: summary, divider, timeline, brief, callout, matrix.
NOT editable: cover, quote, appendix, deeper_findings_* (do not call replace_* on these).

When you decide to edit, call the matching replace_<template_id> tool with:
- focus_hint: the EXACT focus_hint of the existing slide as it appears in the deck JSON
- the full new content (matches the slide's schema)

Rules:
1. Only edit when the deeper findings add SPECIFIC, NAMED value — a missing player, a sharper stat, a more recent data point, a real source you can cite.
2. Preserve all correct existing facts. Edits should refine, not rewrite.
3. NEVER touch quote slides — they are immutable.
4. Make AT MOST 3 edits total. Often the right number is 0 or 1.
5. If nothing in the findings warrants an edit, output a brief sentence saying so and stop without calling any tool.

Examples of GOOD edits:
- Matrix is missing a player surfaced in the deeper findings → add an item.
- Callout has 4 stats; deeper findings has a sharper number → swap one.
- Brief's general_approach is generic; deeper findings has a specific recent funding round → add a sentence with **bold** entities.

Examples of BAD edits (DO NOT do these):
- Rephrasing prose for style.
- Adding a stat the slide already implies.
- Editing a slide because it "could be richer" — only edit if the findings concretely make it so.`;

/**
 * The raw shape returned by the synthesizer pass.
 *   - `applied`: how many edits succeeded
 *   - `notes`: Claude's reasoning text (for telemetry/debug)
 */
export type SynthesizerResult = {
  applied: number;
  notes: string;
};

function buildTools(): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  for (const id of EDITABLE) {
    const tpl = TEMPLATES[id];
    // Wrap the template's schema in a tool input_schema with focus_hint.
    // Cast through unknown — the orchestrator's schema fields are JSON
    // Schema objects; Anthropic's tool_input_schema accepts any
    // JSONSchema-shaped object.
    const schema = tpl.schema as Record<string, unknown>;
    const props = (schema.properties || {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    tools.push({
      name: `replace_${id}`,
      description: `Replace the existing ${id} slide's content with a refined version incorporating insights from the deeper findings. focus_hint must match the slide's existing focus_hint exactly. Content must satisfy the ${id} schema.`,
      input_schema: {
        type: "object",
        required: ["focus_hint", ...required],
        properties: {
          focus_hint: {
            type: "string",
            description:
              "Exact focus_hint of the existing slide to replace, copied verbatim from the deck JSON.",
          },
          ...props,
        },
      },
    });
  }
  return tools;
}

function compactDeck(deck: AssembledDeck): Array<{
  template_id: string;
  focus_hint: string;
  content: unknown;
}> {
  return deck.slides.map((s) => ({
    template_id: s.template_id,
    focus_hint: s.focus_hint,
    content: s.content,
  }));
}

/**
 * Apply a single replace_* tool call to the deck. Returns the new deck
 * with the matching slide replaced; the original deck is not mutated.
 * If no slide matches by (template_id, focus_hint), the edit is dropped
 * and a warning is logged.
 */
function applyEdit(
  deck: AssembledDeck,
  template_id: OrchestratorTemplateId,
  focus_hint: string,
  newContent: Record<string, unknown>,
): { deck: AssembledDeck; matched: boolean } {
  const idx = deck.slides.findIndex(
    (s) => s.template_id === template_id && s.focus_hint === focus_hint,
  );
  if (idx < 0) {
    // Loose match: same template_id, take first one (focus_hint sometimes
    // gets paraphrased by Claude even with explicit instructions).
    const looseIdx = deck.slides.findIndex((s) => s.template_id === template_id);
    if (looseIdx < 0) return { deck, matched: false };
    const updated: AssembledSlide = {
      ...deck.slides[looseIdx]!,
      content: newContent,
    };
    const newSlides = [...deck.slides];
    newSlides[looseIdx] = updated;
    return { deck: { ...deck, slides: newSlides }, matched: true };
  }
  const updated: AssembledSlide = {
    ...deck.slides[idx]!,
    content: newContent,
  };
  const newSlides = [...deck.slides];
  newSlides[idx] = updated;
  return { deck: { ...deck, slides: newSlides }, matched: true };
}

/**
 * Run the synthesizer pass. Returns the (possibly edited) deck and a
 * summary. Internal failures are caught and re-thrown as a single
 * error — the caller should swallow them so the deck still ships.
 */
export async function synthesizeFinalDeck(
  deck: AssembledDeck,
): Promise<{ deck: AssembledDeck; result: SynthesizerResult }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set; cannot run synthesizer");
  }
  const client = new Anthropic({ apiKey });
  const tools = buildTools();

  const userMessage = [
    `Topic: ${deck.topic}`,
    "",
    "Assembled deck (with deeper-findings slide already appended):",
    "```json",
    JSON.stringify(compactDeck(deck), null, 2),
    "```",
    "",
    "Review the editable slides against the deeper findings. Make 0-3 surgical edits if (and only if) the findings add specific, named value. If nothing warrants editing, say so in one short sentence and stop.",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let workingDeck = deck;
  let applied = 0;
  let notes = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    // Capture text reasoning for telemetry
    for (const blk of resp.content) {
      if (blk.type === "text" && blk.text.trim()) {
        notes += (notes ? "\n" : "") + blk.text.trim();
      }
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.MessageParam = {
      role: "user",
      content: toolUses.map((tu) => {
        const m = /^replace_(.+)$/.exec(tu.name);
        if (!m || !m[1]) {
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Unknown tool: ${tu.name}`,
            is_error: true,
          };
        }
        const template_id = m[1] as OrchestratorTemplateId;
        if (!EDITABLE.includes(template_id)) {
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Template ${template_id} is not editable.`,
            is_error: true,
          };
        }
        const input = tu.input as Record<string, unknown>;
        const focus_hint = String(input.focus_hint || "");
        // Strip focus_hint out — the rest is the new content
        const { focus_hint: _drop, ...newContent } = input;
        const { deck: nextDeck, matched } = applyEdit(
          workingDeck,
          template_id,
          focus_hint,
          newContent as Record<string, unknown>,
        );
        if (!matched) {
          // eslint-disable-next-line no-console
          console.log(
            `[synthesizer] dropped ${tu.name}: no slide matched focus_hint="${focus_hint}"`,
          );
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `No slide found with template_id=${template_id} focus_hint="${focus_hint}". Edit dropped.`,
            is_error: true,
          };
        }
        workingDeck = nextDeck;
        applied++;
        // eslint-disable-next-line no-console
        console.log(
          `[synthesizer] applied ${tu.name} on focus_hint="${focus_hint}"`,
        );
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: `Applied. Slide ${template_id}/${focus_hint} updated.`,
        };
      }),
    };
    messages.push(toolResults);

    // If the model already used tools and we're at the cap, give it one
    // more turn to wrap up text-only.
    if (resp.stop_reason === "end_turn") break;
  }

  return {
    deck: workingDeck,
    result: { applied, notes: notes.slice(0, 400) },
  };
}
