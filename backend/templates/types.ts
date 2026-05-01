/**
 * Per-template content types + JSON schemas + prompt builders.
 *
 * These are the single source of truth for what each slide needs from
 * Parallel research. The frontend has matching layout builders that take
 * the same content shapes and return PageSpec objects for `addPage`.
 *
 * IMPORTANT: schemas intentionally OMIT any explicit `source` / `citations`
 * fields — Parallel auto-attaches per-field citations via `basis` on every
 * Chat API response. Duplicating those fields here causes the model to
 * dual-write and disagree with `basis`. We read citations from `basis` only.
 */

/**
 * Templates the orchestrator can choose from. Each one has a JSON schema
 * + buildPrompt and is researched via Chat API by `research_slide`.
 */
export type OrchestratorTemplateId =
  | "cover"
  | "summary"
  | "divider"
  | "timeline"
  | "brief"
  | "callout"
  | "matrix"
  | "quote"
  | "appendix";

/**
 * Full set of template ids that can appear in an assembled deck. Includes
 * `deeper_findings_*` which are produced by the parallel pro-fast task,
 * not the orchestrator.
 */
export type TemplateId =
  | OrchestratorTemplateId
  | "deeper_findings_table"
  | "deeper_findings_text";

export type SlideContent = Record<string, unknown>;

export type TemplateSpec = {
  id: TemplateId;
  /** JSON Schema (subset Parallel supports) for the slide's structured content. */
  schema: object;
  /**
   * Builds the user-message prompt for a research call. Receives the topic and
   * a `focus_hint` chosen by Claude during planning. Must be deterministic.
   */
  buildPrompt: (args: { topic: string; focus_hint: string }) => string;
};

// ===== Per-template content types (consumed by frontend layout builders) =====

export type CoverContent = { date: string; title: string; subtitle: string };

export type SummaryContent = {
  title: string;
  takeaways: Array<{ headline: string; desc: string }>;
};

export type DividerContent = {
  chapterTitle: string;
  dek: string;
  bullets: string[];
};

export type TimelineEvent = {
  side: "above" | "below";
  month: string;
  year: string;
  category: string;
  title: string;
  desc: string;
};

export type TimelineContent = {
  title: string;
  legend: string[];
  events: TimelineEvent[];
};

export type BriefContent = {
  title: string;
  general_approach: string;
  action_areas: Array<{ label: string; desc: string }>;
  commitments: Array<{
    prefix?: string;
    number: string;
    suffix?: string;
    label: string;
  }>;
};

export type CalloutStat = {
  eyebrow?: string;
  prefix?: string;
  number: string;
  suffix?: string;
  qualifier?: string;
  headline: string;
  desc: string;
};

export type CalloutContent = {
  title: string;
  dek: string;
  stats: CalloutStat[];
};

export type MatrixContent = {
  title: string;
  x_axis_label: string;
  y_axis_label: string;
  quadrants: {
    top_left: string;
    top_right: string;
    bot_left: string;
    bot_right: string;
  };
  items: Array<{ x: number; y: number; label: string }>;
};

export type QuoteContent = {
  text: string;
  name: string;
  title?: string;
  organization: string;
};

export type AppendixCitation = {
  author?: string;
  title: string;
  publication?: string;
  date?: string;
  url: string;
};

export type AppendixContent = { citations: AppendixCitation[] };

/**
 * "Deeper findings" slide content — produced by the pro-fast text-mode
 * task that runs alongside the orchestrator. Two layout variants:
 *
 * - `deeper_findings_table`: a markdown table parsed from Ultra/pro-fast
 *   output. Used when the model returned a 4-5-column comparison.
 * - `deeper_findings_text`: prose-only fallback when no table parsed.
 *
 * Both share `title` (extracted from the first H2) and `body` (the
 * paragraphs after the table is removed).
 */
export type DeeperFindingsTableContent = {
  title: string;
  columns: string[];
  rows: string[][];
  body: string;
};

export type DeeperFindingsTextContent = {
  title: string;
  body: string;
};

// ===== Citation envelope returned alongside content =====
// (Mirrors Parallel's `basis` shape but flattened to per-slide use.)

export type SlideCitation = {
  url: string;
  title: string;
  excerpts: string[];
  field?: string; // which output field this cite supports (cover.title, etc.)
  confidence?: "high" | "medium" | "low";
};

/** A slide as it appears in the final assembled deck. */
export type AssembledSlide = {
  template_id: TemplateId;
  focus_hint: string;
  content: SlideContent;
  citations: SlideCitation[];
  interaction_id?: string;
};

export type AssembledDeck = {
  topic: string;
  slides: AssembledSlide[];
};
