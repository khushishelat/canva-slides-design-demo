import type { TemplateSpec } from "./types";

export const timeline: TemplateSpec = {
  id: "timeline",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "legend", "events"],
    properties: {
      title: {
        type: "string",
        minLength: 15,
        description:
          "E.g. '1.1 / Since 2023, ...'. Lead with date anchor + directional claim.",
      },
      legend: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: { type: "string", minLength: 3, description: "1-3 word category label" },
      },
      events: {
        type: "array",
        minItems: 10,
        maxItems: 14,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["side", "month", "year", "category", "title", "desc"],
          properties: {
            side: { type: "string", enum: ["above", "below"] },
            month: {
              type: "string",
              minLength: 3,
              maxLength: 3,
              description: "3-letter ALL CAPS, e.g. 'MAR'.",
            },
            year: { type: "string", minLength: 4, maxLength: 4, description: "4-digit year." },
            category: {
              type: "string",
              minLength: 3,
              description: "Must match a legend label exactly.",
            },
            title: { type: "string", minLength: 3, description: "1-4 words; the named thing." },
            desc: {
              type: "string",
              minLength: 20,
              description: "One short sentence, 6-14 words, verifiable from public source.",
            },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Populate a TIMELINE slide for '${topic}'. Focus: ${focus_hint}. Provide 10-14 real, dated, named milestones from public sources (last 3-4 years). For each event: side (alternate above/below), 3-letter UPPERCASE month, 4-digit year, category (must match one of your legend labels), 1-4 word title, and a 6-14 word description. Provide 4-7 short legend labels. No speculative/future events.`,
};
