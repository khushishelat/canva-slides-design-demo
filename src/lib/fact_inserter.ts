/**
 * Insert a single fact card onto the user's current Canva page as one
 * richtext element with three paragraphs:
 *
 *   STAT     (signal orange, large, medium weight) — the headline number
 *   HEADLINE (Index black, medium, medium weight) — what the number means
 *   CONTEXT  (grey-700, small) + clickable source title (grey-700,
 *            underlined, no color change — signal orange is reserved for
 *            the stat itself per the design system, so links use a quiet
 *            underline instead of competing for attention)
 *
 * Sizing notes:
 * - Stat at 60pt fits on most slides (800–1920 wide) without overflowing.
 *   Earlier 72pt was too aggressive on the typical 800×600 user design.
 * - Headline + context follow at 20pt and 13pt respectively, each in
 *   their own paragraph so Canva's auto line-height handles spacing.
 * - The element width (660px) wraps headline + context but keeps short
 *   stats on one line. User can resize after insertion.
 *
 * Multiple insertions stack at viewport center — Canva doesn't let
 * apps choose absolute coords for `addElementAtPoint`. After inserting,
 * the new element is automatically selected so the user can drag it
 * before inserting another.
 */
import { addElementAtPoint, createRichtextRange } from "@canva/design";
import type { FontRef } from "@canva/design";
import { COLORS } from "src/design/tokens";
import type { FactClaim } from "src/types";

// Sizes tuned for inserted elements on a user's existing slide (not the
// 1920×1080 deck pages). Smaller than the deck's TYPE scale.
const STAT_FONT_SIZE = 60;
const HEADLINE_FONT_SIZE = 20;
const CONTEXT_FONT_SIZE = 13;
const ELEMENT_WIDTH = 660;

/**
 * Optional style override. When the facts page detects a brand color
 * from the user's existing slide, it passes that color in here so the
 * inserted stat matches their design instead of always using Parallel
 * orange. Headline + context stay neutral (Index black + grey-700)
 * since those work on any background.
 */
export type FactInsertStyle = {
  /** Hex color for the big stat. Defaults to Parallel signal orange. */
  accent?: string;
  /** Opaque Canva font reference detected from the user's design. */
  fontRef?: FontRef;
};

export async function insertFact(
  claim: FactClaim,
  style: FactInsertStyle = {},
): Promise<void> {
  const range = createRichtextRange();

  // ---------- 1. STAT (big, brand accent — design override or default) ----------
  const accent = style.accent || COLORS.brand;
  const fontRef = style.fontRef;
  range.appendText(claim.stat);
  range.formatParagraph(
    { index: 0, length: claim.stat.length },
    {
      fontSize: STAT_FONT_SIZE,
      color: accent,
      fontWeight: "medium",
      textAlign: "start",
      ...(fontRef ? { fontRef } : {}),
    },
  );

  range.appendText("\n");

  // ---------- 2. HEADLINE (medium, Index black) ----------
  const headlineStart = claim.stat.length + 1;
  range.appendText(claim.headline);
  range.formatParagraph(
    { index: headlineStart, length: claim.headline.length },
    {
      fontSize: HEADLINE_FONT_SIZE,
      color: COLORS.black,
      fontWeight: "medium",
      textAlign: "start",
      ...(fontRef ? { fontRef } : {}),
    },
  );

  range.appendText("\n");

  // ---------- 3. CONTEXT + cited source (small, grey) ----------
  const contextStart = headlineStart + claim.headline.length + 1;
  const primary = claim.citations[0];
  const sourceLabel =
    primary?.title ||
    (primary?.url
      ? new URL(primary.url).hostname.replace(/^www\./, "")
      : null);
  const sep = "  ·  ";
  const fullContext = sourceLabel
    ? `${claim.context}${sep}${sourceLabel}`
    : claim.context;
  range.appendText(fullContext);
  range.formatParagraph(
    { index: contextStart, length: fullContext.length },
    {
      fontSize: CONTEXT_FONT_SIZE,
      color: COLORS.grey700,
      textAlign: "start",
      ...(fontRef ? { fontRef } : {}),
    },
  );

  // Hyperlink the source label specifically — quiet underline, NO color
  // change. Signal orange is reserved for the stat (Parallel design
  // system: "if orange is everywhere, it's not signaling anything").
  if (primary?.url && sourceLabel) {
    const linkStart = contextStart + claim.context.length + sep.length;
    range.formatText(
      { index: linkStart, length: sourceLabel.length },
      {
        link: primary.url,
        decoration: "underline",
      },
    );
  }

  // Pass as a `DesignElement` (no top/left/width) — Canva places it at
  // viewport center and auto-sizes to content. Adding `width` here
  // pushed the element into the `ElementAtPoint` union variant which
  // also requires `top` + `left`; without those the SDK silently
  // rejected the call (no thrown error, no element added). User can
  // resize after insertion if the auto-width is wrong.
  // eslint-disable-next-line no-console
  console.log(
    `[insertFact] inserting "${claim.stat}" with accent ${accent}`,
  );
  await addElementAtPoint({
    type: "richtext",
    range,
  });
  // Mark element width unused until we revisit positioned inserts.
  void ELEMENT_WIDTH;
}
