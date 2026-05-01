import type { TemplateSpec } from "./types";

export const matrix: TemplateSpec = {
  id: "matrix",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "x_axis_label", "y_axis_label", "quadrants", "items"],
    properties: {
      title: { type: "string", minLength: 10 },
      x_axis_label: { type: "string", minLength: 3, description: "ALL CAPS" },
      y_axis_label: { type: "string", minLength: 3, description: "ALL CAPS" },
      quadrants: {
        type: "object",
        additionalProperties: false,
        required: ["top_left", "top_right", "bot_left", "bot_right"],
        properties: {
          top_left: { type: "string", minLength: 3 },
          top_right: { type: "string", minLength: 3 },
          bot_left: { type: "string", minLength: 3 },
          bot_right: { type: "string", minLength: 3 },
        },
      },
      items: {
        type: "array",
        minItems: 6,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "label"],
          properties: {
            x: { type: "number", minimum: 0, maximum: 1 },
            y: { type: "number", minimum: 0, maximum: 1 },
            label: { type: "string", minLength: 2 },
          },
        },
      },
    },
  },
  buildPrompt: ({ topic, focus_hint }) =>
    `Populate a 2x2 MATRIX slide for '${topic}'. Focus: ${focus_hint}.

Pick analytically meaningful x and y dimensions (ALL CAPS labels). Name the four quadrants with short evocative labels.

Plot 6-12 SPECIFIC NAMED COMPANIES, PRODUCTS, OR ORGANIZATIONS at normalized (x, y) coordinates between 0 and 1, where 0,0 is bottom-left and 1,1 is top-right.

CRITICAL RULES for items:
- Items MUST be specific named entities: "Salesforce Einstein", "Adobe Sensei", "OpenAI ChatGPT", "Microsoft Copilot", "Anthropic Claude", "Novo Nordisk Wegovy".
- DO NOT use generic categories or function names like "Email Marketing", "Personalization", "Other Functions", "Content Creation". Those are NOT valid items.
- Spread items across the 2D space — at least 4 of the 4 quadrants should have items. If items would cluster, reconsider your axis dimensions.
- Each item's (x, y) must reflect REAL public information about that specific entity (filings, press releases, product docs).`,
};
