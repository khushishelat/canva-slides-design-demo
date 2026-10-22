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

// ===== Real images (/api/images) =====

export type SubjectKind =
  | "facility"
  | "person"
  | "product"
  | "logo"
  | "chart"
  | "place"
  | "event"
  | "other";

/** A real, named thing on the slide worth showing (from /api/images/plan). */
export type VisualSubject = {
  id: string;
  label: string;
  kind: SubjectKind;
  objective: string;
  search_queries: string[];
  official_domains: string[];
  /** The phrase on the slide this subject illustrates. */
  why: string;
};

/**
 * official = published by the subject's own organization;
 * commons = Wikimedia Commons; web = everything else.
 */
export type Provenance = "official" | "commons" | "web";

export type ImageCandidate = {
  image_url: string;
  source_page_url: string | null;
  source_host: string | null;
  title: string | null;
  width: number;
  height: number;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  provenance: Provenance;
};

export type SubjectImages = {
  subject_id: string;
  search_id: string;
  images: ImageCandidate[];
  counts: { returned: number; stock_dropped: number; not_uploadable: number };
  elapsed_seconds: number;
};
