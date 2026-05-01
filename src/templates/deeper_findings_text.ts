/**
 * "Deeper findings" — text-only fallback variant. Used when the
 * pro-fast research pass returned prose without a parseable markdown
 * table. Renders as a single full-width prose block with bold runs.
 *
 * Same header/footer chrome as the table variant so the two read as
 * the same slide type with different layouts.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand, richtextWithBold } from "./_shared";
import type { DeeperFindingsTextContent, Dims, PageSpec } from "./types";
import { hline } from "./types";

export function deeperFindingsTextPage(
  content: DeeperFindingsTextContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(
    ...headerBand(
      { kicker: "DEEPER FINDINGS  ·  PRO-FAST" },
      dims,
      fonts,
    ),
  );

  elements.push({
    type: "text",
    children: [cleanLine(content.title)],
    top: inches(0.78),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.sectionTitle,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });
  elements.push(hline(inches(1.65), GUTTER, dims.width - 2 * GUTTER));

  // Body — full-width prose with inline bold
  elements.push({
    type: "richtext",
    range: richtextWithBold({
      text: cleanProse(content.body),
      fontSize: TYPE.bodyLarge,
      color: COLORS.black,
      fontRef: fonts.sans,
    }),
    top: inches(2.0),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
  });

  elements.push(
    ...footerBand(
      {
        source: "PARALLEL  ·  PRO-FAST  ·  DEEPER FINDINGS",
        pageNumber: "98",
      },
      dims,
      fonts,
    ),
  );

  return {
    title: content.title,
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
