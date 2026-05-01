import type { TemplateSpec } from "./types";

export const appendix: TemplateSpec = {
  id: "appendix",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["citations"],
    properties: {
      citations: {
        type: "array",
        minItems: 10,
        maxItems: 14,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url"],
          properties: {
            author: { type: "string" },
            title: { type: "string", minLength: 8 },
            publication: { type: "string" },
            date: { type: "string" },
            url: { type: "string", minLength: 12 },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Compile a CITATIONS APPENDIX for a deck on '${topic}'. Focus: ${focus_hint}. Provide 10-14 high-quality real citations: mix of analyst reports (Gartner/IDC/BloombergNEF/IEA/IQVIA/Evaluate), primary research, news (FT/Reuters/WSJ/Bloomberg), and official filings (SEC, EU, FDA). Each: author, title, publication, date, url. URLs must be real and reachable.`,
};
