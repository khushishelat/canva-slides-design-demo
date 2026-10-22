/**
 * Slide text → the real, named things on it worth showing as images.
 *
 * One Parallel Chat API (`speed`) call with a JSON schema. Two jobs:
 *   - Split the slide into separate subjects. Sending the raw slide text as
 *     one Image Search objective lets the dominant subject crowd out the
 *     rest (a Hyperion + Vera Rubin + Jensen Huang slide came back 9/10
 *     Hyperion, 0 Jensen); one search per subject fixes that.
 *   - Keep it specific. Stock libraries already cover "a data center" or "a
 *     CEO on stage", so we only extract subjects that need the *actual*
 *     thing — a named facility, person, product, logo, place, event, or a
 *     specific report's chart — and write an Image Search request for each.
 *
 * `official_domains` feeds the provenance badge downstream: an image whose
 * source page sits on one of these domains (e.g. nvidianews.nvidia.com for
 * NVIDIA) is first-party, which is the safest thing to put on a slide.
 */
import { randomUUID } from "crypto";
import { chatComplete } from "./parallel_client";
const MAX_SUBJECTS = 4;
const MAX_QUERIES = 3;

export type SubjectKind =
  | "facility"
  | "person"
  | "product"
  | "logo"
  | "chart"
  | "place"
  | "event"
  | "other";

export type VisualSubject = {
  id: string;
  /** Short display label, e.g. "Meta Hyperion data center". */
  label: string;
  kind: SubjectKind;
  /** Natural-language description of the ideal image (Image Search objective). */
  objective: string;
  /** 1–3 short keyword queries. */
  search_queries: string[];
  /** Domains that publish first-party images of this subject. */
  official_domains: string[];
  /** The phrase on the slide this subject illustrates. */
  why: string;
};

const SUBJECTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subjects"],
  properties: {
    subjects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "kind",
          "objective",
          "search_queries",
          "official_domains",
          "why",
        ],
        properties: {
          label: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "facility",
              "person",
              "product",
              "logo",
              "chart",
              "place",
              "event",
              "other",
            ],
          },
          objective: { type: "string" },
          search_queries: { type: "array", items: { type: "string" } },
          official_domains: { type: "array", items: { type: "string" } },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You pick images for a presentation slide.

Read the slide text and list the real, named things a viewer would want to SEE — the specific subjects a stock photo library cannot show. For each one, write a request for a web image search engine.

Include:
- Named facilities, buildings, campuses, sites (e.g. a specific data center or factory)
- Named public figures who are quoted or discussed on the slide
- Named products, chips, vehicles, devices
- Company or organization logos when the company itself is the subject
- A specific report's original chart or figure when the slide cites that report's numbers
- Named places and events

Skip abstract concepts ("growth", "innovation", "AI"), generic categories ("a server rack", "a city"), and anyone who is not a public figure.

Return at most ${MAX_SUBJECTS} subjects, most visually important first. Return an empty list if nothing on the slide is specific enough.

For each subject:
- label: 2–6 words, how a designer would name the image ("Meta Hyperion data center").
- kind: the closest category.
- objective: one or two sentences describing the ideal picture for a 16:9 slide — what must be in frame, angle, setting. Prefer official press or newsroom imagery. For charts, name the publisher and report.
- search_queries: ${MAX_QUERIES} or fewer short keyword queries, the way you would type them into an image search box, each phrasing a different angle.
- official_domains: domains owned by the subject's own organization that publish first-party images — main site, newsroom, investor relations, and dedicated microsites (some companies run separate sites for data centers, sustainability, or investors). Bare hostnames like "nvidia.com". Never news outlets, trade press, or publishers. Empty if none.
- why: the exact short phrase on the slide this image illustrates.`;

export type PlanResult = {
  subjects: VisualSubject[];
  /** True when extraction returned nothing usable and we fell back. */
  fallback: boolean;
};

export async function planVisualSubjects(
  slideText: string,
): Promise<PlanResult> {
  const resp = await chatComplete({
    model: "speed",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `<slide_text>\n${slideText}\n</slide_text>` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "visual_subjects", schema: SUBJECTS_SCHEMA },
    },
  });

  let parsed: { subjects: Omit<VisualSubject, "id">[] };
  try {
    parsed = JSON.parse(resp.choices[0]?.message?.content || "");
  } catch {
    return { subjects: [fallbackSubject(slideText)], fallback: true };
  }

  const subjects = (parsed.subjects || [])
    .slice(0, MAX_SUBJECTS)
    .map((s) => ({
      id: randomUUID(),
      label: s.label.trim(),
      kind: s.kind,
      objective: s.objective.trim(),
      search_queries: s.search_queries
        .map((q) => q.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, MAX_QUERIES),
      official_domains: s.official_domains
        .map(normalizeDomain)
        .filter((d): d is string => !!d),
      why: s.why.trim(),
    }))
    .filter((s) => s.label && s.search_queries.length > 0);

  if (subjects.length === 0) {
    return { subjects: [fallbackSubject(slideText)], fallback: true };
  }
  return { subjects, fallback: false };
}

/** Use the slide text itself as one query when extraction isn't usable. */
function fallbackSubject(slideText: string): VisualSubject {
  const q = slideText.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    id: randomUUID(),
    label: q.length > 48 ? q.slice(0, 47) + "…" : q,
    kind: "other",
    objective: `Photos that illustrate: ${q}`,
    search_queries: [q],
    official_domains: [],
    why: q,
  };
}

function normalizeDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}
