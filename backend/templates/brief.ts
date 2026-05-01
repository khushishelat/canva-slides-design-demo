import type { TemplateSpec } from "./types";

export const brief: TemplateSpec = {
  id: "brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "general_approach", "action_areas", "commitments"],
    properties: {
      title: {
        type: "string",
        minLength: 10,
        maxLength: 70,
        description:
          "Slide title — must fit on ONE line. Format like '1.2 / Short angle.' Keep under 60 chars to be safe; absolute max 70.",
      },
      general_approach: {
        type: "string",
        minLength: 400,
        maxLength: 750,
        description:
          "EXACTLY 3 short paragraphs of observational research prose, separated by \\n\\n. Each paragraph is 2-3 sentences (NOT 4). TOTAL field length must be under 750 chars — the column has finite vertical room and prose past that overflows into the footer. Use **double asterisks** to bold AT LEAST 5 named entities/numbers across the whole field. Do NOT bold whole sentences; bold only the specific entity/number. Example: 'In Q3 2024, **Pinecone** raised **$100M** at a **$750M valuation**.'",
      },
      action_areas: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        description:
          "Exactly 4 KEY DIMENSIONS. Each dimension's combined label+desc must FIT in a small grid cell — keep both short or text will overlap adjacent rows.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "desc"],
          properties: {
            label: {
              type: "string",
              minLength: 6,
              maxLength: 30,
              description:
                "Short 2-line noun phrase naming the dimension. Use \\n to wrap. e.g. 'Evaluation\\n& benchmarks' or 'Pricing\\nstructure'. Max 30 chars.",
            },
            desc: {
              type: "string",
              minLength: 30,
              maxLength: 110,
              description:
                "ONE short observational sentence with **bold** on the entity/number. HARD CAP 110 chars — longer descriptions overlap the next row. Keep terse.",
            },
          },
        },
      },
      commitments: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "EXACTLY 3 HEADLINE STATS from the research. Each stat is a researched quantitative finding with a real source — NOT an ordinal/index, NOT an action item, NOT a step in a process. The (prefix, number, suffix) concatenate to render as ONE big stat: e.g. ('$', '24', 'B') → '$24B', ('', '88', '%') → '88%', ('', '3.2', 'x') → '3.2x'. The label cites the source: e.g. 'of CPG marketers use AI daily (Salesforce 2024)'.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["number", "label"],
          properties: {
            prefix: {
              type: "string",
              description: "Currency or unit prefix. Common: '$', '€', '£'. Empty string for plain numbers/percentages.",
            },
            number: {
              type: "string",
              minLength: 1,
              description: "The hard number itself (e.g. '24', '88', '3.2', '750'). NEVER '1', '2', '3' as ordinals — those are forbidden index numbers, not stats.",
            },
            suffix: {
              type: "string",
              description: "Unit/multiplier suffix. Common: '%', 'B', 'M', 'K', 'x', '+', 'bps'. At least 2 of the 3 commitments MUST have a non-empty prefix OR suffix.",
            },
            label: {
              type: "string",
              minLength: 8,
              maxLength: 90,
              description:
                "What the number measures, ending with the source in parens. E.g. 'of enterprises run vector DBs in production (Gartner 2024)'. HARD CAP 90 chars to fit next to the big number.",
            },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Write a RESEARCH ZOOM-IN slide that drills into one specific facet of '${topic}'. Focus: ${focus_hint}.

This slide is OBSERVATIONAL research, not strategy. You are surfacing WHAT IS HAPPENING — named entities, dates, dollar amounts, percentages, multiples — with public sources. You are NOT recommending actions, targets, or next steps.

=== Output ===

title — the specific research angle, MAX 70 CHARS, fits on one line. e.g. "1.2 / CPG brands using generative AI for creative testing". Avoid wordy framings that wrap.

general_approach — EXACTLY 3 paragraphs separated by \\n\\n (a blank line between each). Each paragraph is 2-3 sentences of observational research prose. Cite specific companies, products, dates, and quantitative claims. **Total field MUST stay under 750 chars** — longer prose overflows the column into the footer. Use **double-asterisk markers** to bold AT LEAST 5 named entities/numbers across the whole field — these render as inline bold and are how the slide stays scannable. Bold only the specific entity or number, never a whole sentence. Write past/present observational ("Pinecone announced…", "P&G reported…"), NEVER prescriptive ("firms should…").

  GOOD example of bold density: "In Q3 2024, **Pinecone** closed a **$100M** Series B at a **$750M valuation** led by **Andreessen Horowitz**, while rival **Weaviate** crossed **2,000 enterprise customers** in the same window."

action_areas — exactly 4 KEY DIMENSIONS. Each label is a SHORT 2-line noun phrase (max 30 chars; e.g. "Pricing\\nstructure"). Each desc is ONE TERSE observational sentence (HARD CAP 110 chars) with **bold** on the entity/number. Long desc text WILL overflow the row and overlap the next dimension — keep them under the cap. Examples:
  - { label: "Funding\\nshape", desc: "**Pinecone** raised **$100M Series B** at a **$750M** valuation in 2024." }
  - { label: "Operating\\nmargin", desc: "**85% gross margin** typical for SaaS vector DBs vs **30%** for self-hosted." }

commitments — exactly 3 HEADLINE STATS. **THIS IS THE MOST IMPORTANT FIELD — READ CAREFULLY.**

  ❌ FORBIDDEN — these are NOT stats, they are ordinals/action items and will be rejected:
     - { number: "1", label: "Model query volume and cost" }
     - { number: "2", label: "Evaluate managed vs self-hosted" }
     - { number: "3", label: "Negotiate enterprise terms" }

  ✅ REQUIRED — these are real researched stats with a hard number and a cited source:
     - { prefix: "$", number: "24", suffix: "B", label: "global vector DB market by 2030 (Mordor Intelligence 2024)" }
     - { prefix: "", number: "88", suffix: "%", label: "of CPG marketers use AI daily (Salesforce 2024)" }
     - { prefix: "", number: "3.2", suffix: "x", label: "creative testing speed-up reported by P&G" }
     - { prefix: "", number: "100", suffix: "M", label: "Pinecone Series B at $750M valuation (Crunchbase 2024)" }
     - { prefix: "", number: "80", suffix: "+", label: "queries/month threshold where self-hosting wins (OpenMetal 2024)" }

  Rules:
  1. The (prefix, number, suffix) concatenate into one stat the reader sees as a single hero number — make it visually substantial (NOT a bare digit like "1" or "5").
  2. AT LEAST 2 of the 3 commitments must have a non-empty prefix OR suffix ($, %, B, M, K, x, +, bps, etc.).
  3. The label MUST end in parens citing a real source publication and year — e.g. "(Gartner 2024)", "(McKinsey State of AI 2025)", "(IDC 2026)".
  4. If you can't find 3 hard stats for this focus, surface 3 anyway from the broader topic — every brief slide ships 3 metrics.`,
};
