import type { TemplateSpec } from "./types";

/**
 * Quote slide.
 *
 * Important: this template is **immutable** during orchestration. The
 * orchestrator system prompt forbids `follow_up_slide(template_id="quote")`
 * because the worker would replace the quote text on follow-up. If a quote's
 * claim raises a question, Claude fires research on a different template.
 */
export const quote: TemplateSpec = {
  id: "quote",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text", "name", "organization"],
    properties: {
      text: {
        type: "string",
        minLength: 80,
        description:
          "The quote, 3-5 lines (~25-50 words). Must be a real, verifiable, attributed quote — verbatim, not paraphrased.",
      },
      name: { type: "string", minLength: 4 },
      title: { type: "string", description: "Job title." },
      organization: { type: "string", minLength: 2 },
    },
  },
  // Prompt is overridden inside the quote_hunt tool, which uses progressively
  // wider personas across up to 3 internal retries. This buildPrompt is a
  // sensible default in case a non-quote_hunt path ever hits this template.
  buildPrompt: ({ topic, focus_hint }) =>
    `Find a real, verifiable, attributed QUOTE for a deck on '${topic}'. Focus: ${focus_hint}. The quote (3-5 lines, ~25-50 words) must be from a named industry figure (CEO, regulator, analyst, researcher) and traceable to a real public source (interview, earnings call, conference talk, paper). Provide name, job title, organization. DO NOT invent quotes.`,
};
