import type { TemplateSpec } from "./types";

export const summary: TemplateSpec = {
  id: "summary",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "takeaways"],
    properties: {
      title: {
        type: "string",
        minLength: 20,
        description: "8-14 words; previews the through-line of the deck.",
      },
      takeaways: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "desc"],
          properties: {
            headline: {
              type: "string",
              minLength: 12,
              description: "5-10 word punchy claim. No hedging.",
            },
            desc: {
              type: "string",
              minLength: 40,
              description:
                "One sentence, 18-30 words, with a specific number, mechanism, or named actor.",
            },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Write the EXECUTIVE SUMMARY of a research deck on '${topic}'. Focus: ${focus_hint}. Produce exactly 5 ordered takeaways (most surprising first). Each headline 5-10 words; each desc one sentence (18-30 words) with a specific number, mechanism, or named actor. Anchor every takeaway in real public sources.`,
};
