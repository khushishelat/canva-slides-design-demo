import type { TemplateSpec } from "./types";

export const callout: TemplateSpec = {
  id: "callout",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "dek", "stats"],
    properties: {
      title: { type: "string", minLength: 10 },
      dek: { type: "string", minLength: 30, description: "1-2 sentence framing." },
      stats: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "headline", "desc"],
          properties: {
            eyebrow: {
              type: "string",
              description: "ALL CAPS short tag, e.g. '01 / ENTERPRISE ADOPTION'",
            },
            prefix: { type: "string", description: "e.g. '$'" },
            number: {
              type: "string",
              minLength: 1,
              description: "Hard number, e.g. '87'",
            },
            suffix: { type: "string", description: "e.g. '%', 'B', '×'" },
            qualifier: { type: "string", description: "ALL CAPS short qualifier" },
            headline: { type: "string", minLength: 8 },
            desc: {
              type: "string",
              minLength: 30,
              description:
                "One sentence of context, with a real source named in-line, e.g. '... per Gartner, 2026.'",
            },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Populate a 3-STAT CALLOUT slide for '${topic}'. Focus: ${focus_hint}. Produce exactly 3 hard statistics, each with eyebrow (ALL CAPS '01 / ...'), optional prefix/suffix, the number itself, an ALL CAPS qualifier, a headline, and a one-sentence desc that names a real citable source in-line (e.g., 'BloombergNEF 2025', 'IEA 2025'). Numbers must be defensible. Source diversity matters: each stat should ideally come from a DIFFERENT publisher.`,
};
