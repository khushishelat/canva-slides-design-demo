/**
 * Frontend template registry — maps template_id to its layout builder.
 * Called by the deck inserter to turn an assembled slide into a PageSpec.
 */
import type { FontRef } from "@canva/asset";
import { appendixPage } from "./appendix";
import { briefPage } from "./brief";
import { calloutPage } from "./callout";
import { coverPage } from "./cover";
import { deeperFindingsTablePage } from "./deeper_findings_table";
import { deeperFindingsTextPage } from "./deeper_findings_text";
import { dividerPage } from "./divider";
import { matrixPage } from "./matrix";
import { quotePage } from "./quote";
import { summaryPage } from "./summary";
import { timelinePage } from "./timeline";
import type {
  AppendixContent,
  AssembledSlide,
  BriefContent,
  CalloutContent,
  CoverContent,
  DeeperFindingsTableContent,
  DeeperFindingsTextContent,
  Dims,
  DividerContent,
  MatrixContent,
  PageSpec,
  QuoteContent,
  SummaryContent,
  TemplateId,
  TimelineContent,
} from "./types";

export type Fonts = { sans?: FontRef; mono?: FontRef };

type Builder = (content: unknown, dims: Dims, fonts: Fonts) => PageSpec;

export const BUILDERS: Record<TemplateId, Builder> = {
  cover: (c, d, f) => coverPage(c as CoverContent, d, f),
  summary: (c, d, f) => summaryPage(c as SummaryContent, d, f),
  divider: (c, d, f) => dividerPage(c as DividerContent, d, f),
  timeline: (c, d, f) => timelinePage(c as TimelineContent, d, f),
  brief: (c, d, f) => briefPage(c as BriefContent, d, f),
  callout: (c, d, f) => calloutPage(c as CalloutContent, d, f),
  matrix: (c, d, f) => matrixPage(c as MatrixContent, d, f),
  quote: (c, d, f) => quotePage(c as QuoteContent, d, f),
  appendix: (c, d, f) => appendixPage(c as AppendixContent, d, f),
  deeper_findings_table: (c, d, f) =>
    deeperFindingsTablePage(c as DeeperFindingsTableContent, d, f),
  deeper_findings_text: (c, d, f) =>
    deeperFindingsTextPage(c as DeeperFindingsTextContent, d, f),
};

export function buildPage(slide: AssembledSlide, dims: Dims, fonts: Fonts): PageSpec {
  const builder = BUILDERS[slide.template_id];
  if (!builder) throw new Error(`No builder registered for ${slide.template_id}`);
  return builder(slide.content, dims, fonts);
}
