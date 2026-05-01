/**
 * Shared types between frontend and backend templates. Mirror the
 * backend/templates/types.ts definitions exactly. Kept duplicated (rather
 * than imported across the boundary) because the frontend bundles via
 * webpack and shouldn't reach into the backend tree.
 */
import type {
  ElementAtPoint,
  PageBackgroundFill,
  ShapeElementAtPoint,
} from "@canva/design";
import { COLORS } from "src/design/tokens";

export type TemplateId =
  | "cover"
  | "summary"
  | "divider"
  | "timeline"
  | "brief"
  | "callout"
  | "matrix"
  | "quote"
  | "appendix"
  | "deeper_findings_table"
  | "deeper_findings_text";

export type Dims = { width: number; height: number };

export type PageSpec = {
  title?: string;
  background?: PageBackgroundFill;
  elements: ElementAtPoint[];
  dimensions?: Dims;
};

export type SlideCitation = {
  url: string;
  title: string;
  excerpts: string[];
  field?: string;
  confidence?: "high" | "medium" | "low";
};

export type AssembledSlide<C = Record<string, unknown>> = {
  template_id: TemplateId;
  focus_hint: string;
  content: C;
  citations: SlideCitation[];
  interaction_id?: string;
};

export type AssembledDeck = {
  topic: string;
  slides: AssembledSlide[];
};

// ===== Per-template content types (one per template) =====

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

/** "Deeper findings" content — see backend/templates/types.ts for the why. */
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

// ===== Shape primitives =====
// Reused across all 9 layouts. Lines are thin filled rectangles since
// Canva doesn't have a native line element.
//
// IMPORTANT: viewBox dimensions are matched to the shape's actual width/
// height, and path coords are in those same units. Earlier the helper
// used a fixed 100×100 viewBox with a path filling 0–100 in both axes —
// some Canva shape renderings don't stretch viewBox proportionally for
// extreme aspect ratios (e.g. a 1800×2 axis line ended up invisible,
// and a 649×202 background block on the brief slide rendered at the
// wrong width). Matching the viewBox to actual size sidesteps that
// entire class of issue.

export function rect(
  top: number,
  left: number,
  width: number,
  height: number,
  fillColor: string,
): ShapeElementAtPoint {
  // Min 2px on either dimension so very thin lines still render visibly.
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  return {
    type: "shape",
    top: Math.round(top),
    left: Math.round(left),
    width: w,
    height: h,
    viewBox: { top: 0, left: 0, width: w, height: h },
    paths: [
      {
        d: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
        fill: { color: fillColor },
      },
    ],
  };
}

export function vline(
  top: number,
  left: number,
  height: number,
  color: string = COLORS.grey300,
): ShapeElementAtPoint {
  return rect(top, left, 2, height, color);
}

export function hline(
  top: number,
  left: number,
  width: number,
  color: string = COLORS.grey300,
): ShapeElementAtPoint {
  return rect(top, left, width, 2, color);
}
