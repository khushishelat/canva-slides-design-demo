/**
 * The three tools Claude can call during deck orchestration:
 *
 *   research_slide  — initial worker for one slide
 *   follow_up_slide — refine an existing slide via previous_interaction_id
 *   quote_hunt      — specialized for the quote slide; 3 internal retries
 *
 * Each tool calls Parallel's Chat API with the model `core` and returns
 * structured content + per-field basis citations + interaction_id +
 * thinness_signals so Claude can decide whether to follow up.
 */
import { chatComplete } from "./parallel_client";
import { TEMPLATES, getTemplate } from "../templates/_registry";
import type {
  OrchestratorTemplateId,
  SlideCitation,
  TemplateId,
} from "../templates/types";

const MODEL = "core" as const;

export type ThinnessSignals = {
  citations_count: number;
  unique_domain_count: number;
  empty_required_fields: string[];
  short_excerpts: number; // count of citations whose excerpts are < 30 chars
  unique_publication_count: number;
};

export type WorkerResult = {
  template_id: TemplateId;
  content: Record<string, unknown> | null;
  citations: SlideCitation[];
  interaction_id?: string;
  thinness_signals: ThinnessSignals;
  error?: string;
};

// ===== Helpers =====

function flattenBasis(
  basis: Array<{
    field: string;
    citations?: Array<{ url: string; title: string | null; excerpts: string[] | null }>;
    confidence?: "high" | "medium" | "low";
  }> | undefined,
): SlideCitation[] {
  if (!basis) return [];
  const out: SlideCitation[] = [];
  for (const entry of basis) {
    for (const c of entry.citations || []) {
      if (!c.url) continue;
      out.push({
        url: c.url,
        title: c.title || hostname(c.url),
        excerpts: c.excerpts || [],
        field: entry.field,
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

function deriveThinnessSignals(
  content: Record<string, unknown> | null,
  citations: SlideCitation[],
  schema: { required?: string[] },
): ThinnessSignals {
  const empty: string[] = [];
  for (const field of schema.required || []) {
    const v = content?.[field];
    if (v == null) {
      empty.push(field);
      continue;
    }
    if (typeof v === "string" && v.trim().length === 0) {
      empty.push(field);
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      empty.push(field);
    }
  }
  const domains = new Set<string>();
  let shortExcerpts = 0;
  for (const c of citations) {
    domains.add(hostname(c.url));
    if (c.excerpts.every((e) => e.length < 30)) shortExcerpts++;
  }
  // Approximate publication count via domain (good enough for our heuristic)
  return {
    citations_count: citations.length,
    unique_domain_count: domains.size,
    unique_publication_count: domains.size,
    empty_required_fields: empty,
    short_excerpts: shortExcerpts,
  };
}

// ===== Tool 1: research_slide =====

export async function researchSlide(args: {
  template_id: OrchestratorTemplateId;
  topic: string;
  focus_hint: string;
}): Promise<WorkerResult> {
  const { template_id, topic, focus_hint } = args;
  const tpl = getTemplate(template_id);
  const prompt = tpl.buildPrompt({ topic, focus_hint });
  try {
    const resp = await chatComplete({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: template_id, schema: tpl.schema },
      },
    });
    const raw = resp.choices[0]?.message?.content;
    let content: Record<string, unknown> | null = null;
    if (raw) {
      try {
        content = JSON.parse(raw);
      } catch {
        content = null;
      }
    }
    const citations = flattenBasis(resp.basis);
    return {
      template_id,
      content,
      citations,
      interaction_id: resp.interaction_id,
      thinness_signals: deriveThinnessSignals(
        content,
        citations,
        tpl.schema as { required?: string[] },
      ),
    };
  } catch (err: unknown) {
    return {
      template_id,
      content: null,
      citations: [],
      thinness_signals: {
        citations_count: 0,
        unique_domain_count: 0,
        unique_publication_count: 0,
        empty_required_fields: [],
        short_excerpts: 0,
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ===== Tool 2: follow_up_slide =====

export async function followUpSlide(args: {
  template_id: OrchestratorTemplateId;
  interaction_id: string;
  instruction: string;
}): Promise<WorkerResult> {
  const { template_id, interaction_id, instruction } = args;
  if (template_id === "quote") {
    // Hard rule: quote slides are immutable. The orchestrator system prompt
    // already forbids this, but enforce defensively here too in case Claude
    // ignores the rule under unusual conditions.
    return {
      template_id,
      content: null,
      citations: [],
      thinness_signals: {
        citations_count: 0,
        unique_domain_count: 0,
        unique_publication_count: 0,
        empty_required_fields: [],
        short_excerpts: 0,
      },
      error:
        "follow_up_slide is not allowed on quote template. Quote slides are immutable.",
    };
  }
  const tpl = getTemplate(template_id);
  try {
    const resp = await chatComplete({
      model: MODEL,
      messages: [{ role: "user", content: instruction }],
      response_format: {
        type: "json_schema",
        json_schema: { name: template_id, schema: tpl.schema },
      },
      previous_interaction_id: interaction_id,
    });
    const raw = resp.choices[0]?.message?.content;
    let content: Record<string, unknown> | null = null;
    if (raw) {
      try {
        content = JSON.parse(raw);
      } catch {
        content = null;
      }
    }
    const citations = flattenBasis(resp.basis);
    return {
      template_id,
      content,
      citations,
      interaction_id: resp.interaction_id,
      thinness_signals: deriveThinnessSignals(
        content,
        citations,
        tpl.schema as { required?: string[] },
      ),
    };
  } catch (err: unknown) {
    return {
      template_id,
      content: null,
      citations: [],
      thinness_signals: {
        citations_count: 0,
        unique_domain_count: 0,
        unique_publication_count: 0,
        empty_required_fields: [],
        short_excerpts: 0,
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ===== Tool 3: quote_hunt =====

const QUOTE_PROMPTS = [
  // Attempt 1 — CEO/founder/executive
  (topic: string, focus_hint: string, persona_hint?: string) =>
    `Find a real, verifiable, attributed verbatim QUOTE for a research deck on '${topic}'. Focus: ${focus_hint}. ${persona_hint ? `Prefer a quote from: ${persona_hint}.` : ""} The quote (3-5 lines, ~25-50 words) must be from a CEO, founder, or executive in this space, dated 2024 or later, and traceable to a real public source (interview, earnings call, conference keynote, official letter). Provide name, job title, organization. DO NOT paraphrase or invent.`,
  // Attempt 2 — researcher / policy figure
  (topic: string, focus_hint: string) =>
    `The first attempt didn't produce a verifiable executive quote. Try a researcher, policy figure, regulator, or academic instead. Topic: '${topic}'. Focus: ${focus_hint}. Look in earnings call transcripts, keynote speeches, peer-reviewed publications, or regulatory filings from 2024 or later. The quote must be verbatim, ~25-50 words, with name, title, and organization.`,
  // Attempt 3 — wider net
  (topic: string, focus_hint: string) =>
    `Cast a wider net. Topic: '${topic}'. Focus: ${focus_hint}. Try investors, journalists with named bylines, clinicians, or domain experts. Last 18 months only. The quote must be verbatim (NOT paraphrased), 25-50 words, with full attribution. If you genuinely cannot find one, return your best candidate with the most confidence in the attribution.`,
];

export async function quoteHunt(args: {
  topic: string;
  focus_hint: string;
  persona_hint?: string;
}): Promise<WorkerResult & { attempts: number }> {
  const { topic, focus_hint, persona_hint } = args;
  const tpl = getTemplate("quote");
  let lastErr: string | undefined;
  for (let attempt = 0; attempt < QUOTE_PROMPTS.length; attempt++) {
    const promptFn = QUOTE_PROMPTS[attempt];
    if (!promptFn) continue;
    const prompt = attempt === 0
      ? promptFn(topic, focus_hint, persona_hint)
      : promptFn(topic, focus_hint);
    try {
      const resp = await chatComplete({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "quote", schema: tpl.schema },
        },
      });
      const raw = resp.choices[0]?.message?.content;
      let content: Record<string, unknown> | null = null;
      if (raw) {
        try {
          content = JSON.parse(raw);
        } catch {
          content = null;
        }
      }
      const citations = flattenBasis(resp.basis);
      const signals = deriveThinnessSignals(
        content,
        citations,
        tpl.schema as { required?: string[] },
      );
      // Success criteria: required fields populated AND at least 1 citation
      if (
        content &&
        signals.empty_required_fields.length === 0 &&
        signals.citations_count >= 1
      ) {
        return {
          template_id: "quote",
          content,
          citations,
          interaction_id: resp.interaction_id,
          thinness_signals: signals,
          attempts: attempt + 1,
        };
      }
      // Otherwise loop to next attempt
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    template_id: "quote",
    content: null,
    citations: [],
    thinness_signals: {
      citations_count: 0,
      unique_domain_count: 0,
      unique_publication_count: 0,
      empty_required_fields: [],
      short_excerpts: 0,
    },
    error: lastErr || "quote_hunt exhausted all attempts without a verifiable quote",
    attempts: QUOTE_PROMPTS.length,
  };
}

// ===== Tool definitions for Claude =====
// These describe the tools to Claude via the Anthropic SDK's tool-use schema.
// `as const` on the input_schema.type narrows it to "object" so the SDK
// type-checks; the Anthropic Tool type expects the literal.

import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "research_slide",
    description:
      "Research one slide via the Parallel `core` model. Returns structured content matching the template's JSON schema, plus per-field basis citations and thinness_signals (citations_count, unique_domain_count, empty_required_fields, short_excerpts, unique_publication_count). Fire many of these in parallel in your first turn.",
    input_schema: {
      type: "object" as const,
      properties: {
        template_id: { type: "string", enum: Object.keys(TEMPLATES) },
        topic: { type: "string" },
        focus_hint: {
          type: "string",
          description: "Specific angle/focus for this slide.",
        },
      },
      required: ["template_id", "topic", "focus_hint"],
    },
  },
  {
    name: "follow_up_slide",
    description:
      "Follow-up call using a previous interaction_id. Fire freely whenever a slide reads generic, sources cluster on one publisher, a claim is undersourced, or a stat could be sharpened. Up to 5 follow-ups per slide, 15 total per deck. NEVER use this with template_id='quote' — quote slides are immutable.",
    input_schema: {
      type: "object" as const,
      properties: {
        template_id: { type: "string", enum: Object.keys(TEMPLATES) },
        interaction_id: { type: "string" },
        instruction: {
          type: "string",
          description:
            "What to refine. Be specific and editorial: 'cross-validate the $48B forecast against Goldman or Morgan Stanley', 'drop the Yahoo Finance citation and find a Tier-1 alternative'.",
        },
      },
      required: ["template_id", "interaction_id", "instruction"],
    },
  },
  {
    name: "quote_hunt",
    description:
      "Specialized tool for the QUOTE slide. Tries up to 3 progressively wider personas (CEO → researcher/policymaker → broader expert) and returns the first verifiable, attributed verbatim quote it finds. Use this — not research_slide — for the quote slide.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: { type: "string" },
        focus_hint: { type: "string" },
        persona_hint: {
          type: "string",
          description:
            "Optional preferred persona, e.g. 'Novo Nordisk or Eli Lilly executive'.",
        },
      },
      required: ["topic", "focus_hint"],
    },
  },
];
