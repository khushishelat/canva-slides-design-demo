import type { TemplateSpec } from "./types";

export const cover: TemplateSpec = {
  id: "cover",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["date", "title", "subtitle"],
    properties: {
      date: {
        type: "string",
        minLength: 5,
        description: "'MMM YYYY' uppercase, e.g. 'APR 2026'.",
      },
      title: {
        type: "string",
        minLength: 10,
        description:
          "Deck title, 4-12 words, may include one \\n line-break. Specific topic + angle.",
      },
      subtitle: {
        type: "string",
        minLength: 30,
        description:
          "One sentence, 18-35 words: scope, time window, methodology.",
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Write the COVER slide of a research deck on '${topic}'. Focus: ${focus_hint}. Output a strong title (4-12 words; may include one \\n) and a one-sentence subtitle (18-35 words) previewing the analytical angle, time window, and methodology. Use the current month and year for the date in 'MMM YYYY' uppercase format unless context dictates otherwise.`,
};
