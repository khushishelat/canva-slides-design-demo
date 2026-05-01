/**
 * Central registry. Both the orchestrator (when picking templates) and
 * the worker tools (when building schemas + prompts) import from here.
 */
import { appendix } from "./appendix";
import { brief } from "./brief";
import { callout } from "./callout";
import { cover } from "./cover";
import { divider } from "./divider";
import { matrix } from "./matrix";
import { quote } from "./quote";
import { summary } from "./summary";
import { timeline } from "./timeline";
import type { OrchestratorTemplateId, TemplateSpec } from "./types";

/**
 * Only orchestrator-driven templates have specs (schema + prompt). The
 * `deeper_findings_*` slides come from a parallel pro-fast text task,
 * not from `research_slide`, so they're absent here intentionally.
 */
export const TEMPLATES: Record<OrchestratorTemplateId, TemplateSpec> = {
  cover,
  summary,
  divider,
  timeline,
  brief,
  callout,
  matrix,
  quote,
  appendix,
};

export const TEMPLATE_IDS: OrchestratorTemplateId[] = Object.keys(
  TEMPLATES,
) as OrchestratorTemplateId[];

export function getTemplate(id: OrchestratorTemplateId): TemplateSpec {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}
