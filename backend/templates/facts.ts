/**
 * Facts mode — produces 5–10 cited stat callouts ("fact cards") for a
 * topic, designed to be inserted as individual elements onto an existing
 * slide rather than as a full deck.
 *
 * Distinct from the deck templates because:
 *   - No layout file; each card is a single richtext element placed via
 *     addElementAtPoint (see src/lib/fact_inserter.ts)
 *   - No SSE / job orchestration; the backend polls Task API until done
 *     and returns the enriched claims to the frontend in one response
 *   - Returned to the user as a list they can browse and individually
 *     insert into their current design
 *
 * IMPORTANT: Parallel's Task API rejects `minItems`, `maxItems`, and
 * `minLength` keywords in output schemas (returns a 422 with
 * `Unsupported keyword`). The count + length constraints have to be
 * encoded in the prompt + property descriptions instead, which the
 * model treats as soft guidance.
 */

export const factsSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      description:
        "Between 3 and 5 cited factual claims (inclusive). Each must be quantitative or definitive (statistics, percentages, dates, named entities), surfaced from real public sources. Prioritize quality over quantity — only the most surprising and well-sourced facts.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "stat", "context"],
        properties: {
          headline: {
            type: "string",
            description:
              "3–7 word punchy claim, at least 8 characters. No hedging. E.g. 'BYD overtakes Tesla in EV sales'.",
          },
          stat: {
            type: "string",
            description:
              "The hard number, formatted with prefix/suffix as appropriate. Examples: '$24B', '88%', '3.2x', '2.26M', '40%+'.",
          },
          context: {
            type: "string",
            description:
              "One sentence (18–30 words, at least 30 characters) of context naming a real public source in-line, e.g. '... per IDC Agentic AI Outlook, 2026.'",
          },
          category: {
            type: "string",
            description: "Optional 1–2 word category tag for filtering.",
          },
        },
      },
    },
  },
};

export function buildFactsPrompt(topic: string): string {
  return [
    `Surface 3-5 cited factual claims about: '${topic}'.`,
    "",
    "Each claim is a standalone fact card the reader can drop into a slide. Requirements:",
    "- Each claim must be quantitative (statistic, percentage, dollar amount, multiplier, count) OR definitive (date, named entity, ranking).",
    "- Headline: 3-7 punchy words, no hedging.",
    "- Stat: the hard number itself, formatted with prefix/suffix as appropriate (e.g. '$24B', '88%', '3.2x', '2.26M', '40%+').",
    "- Context: one sentence (18-30 words) explaining what the number is, with a real public source named in-line (e.g. 'per IDC Agentic AI Outlook, 2026.', 'McKinsey State of AI 2025.', 'IEA Global EV Outlook 2025.').",
    "- Prioritize the most surprising and significant facts first.",
    "- Anchor every claim in a real, recent (2024–2026 preferred) public source — analyst reports, government data, peer-reviewed research, reputable publications, primary filings.",
    "- Avoid generic numbers everyone knows; surface specifics that would make a reader pause.",
  ].join("\n");
}
