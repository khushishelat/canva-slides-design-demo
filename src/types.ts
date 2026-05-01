/**
 * Shared frontend types. The deck-related types live in `src/templates/types`
 * — this file holds only app-wide types (errors, etc).
 */

export type Citation = {
  url: string;
  title: string;
  excerpts: string[];
  confidence?: "high" | "medium" | "low";
};

/**
 * A single fact card from /api/facts. Designed to be inserted as a
 * standalone richtext element on the user's current Canva slide.
 */
export type FactClaim = {
  id: string;
  headline: string;
  stat: string;
  context: string;
  category?: string;
  citations: Citation[];
};
