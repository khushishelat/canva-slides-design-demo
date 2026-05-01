import type { TemplateSpec } from "./types";

export const divider: TemplateSpec = {
  id: "divider",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["chapterTitle", "dek", "bullets"],
    properties: {
      chapterTitle: {
        type: "string",
        minLength: 4,
        description: "2-5 words; may include one \\n.",
      },
      dek: {
        type: "string",
        minLength: 30,
        description: "One sentence, 12-22 words framing the section.",
      },
      bullets: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "string",
          minLength: 4,
          description: "2-5 word topic label",
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Write a SECTION DIVIDER for a research deck on '${topic}'. Focus: ${focus_hint}. Output a 2-5 word chapter title (may include one \\n), a one-sentence dek (12-22 words), and 3-5 short bullets (2-5 words each) naming the segments covered.`,
};
