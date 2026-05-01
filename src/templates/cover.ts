/**
 * Cover slide — port of build_cover_slide.js.
 *
 * Layout:
 *   - Header: kicker top-left + date right-aligned + thin divider
 *   - Vertical orange BRACKET on the right edge (Parallel signature, hero
 *     accent — runs from y=1.40 to y=5.60)
 *   - Hero title at fontSize ~88, multi-line allowed
 *   - Subtitle at y=4.55, smaller, muted grey
 *   - Bottom divider at y=6.15
 *   - AUTHOR / TEAM / DATE metadata mono row beneath the divider
 *   - "INTERNAL BRIEF · NOT FOR EXTERNAL DISTRIBUTION" context line
 *   - Footer divider + page number
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse } from "./_shared";
import type { CoverContent, Dims, PageSpec } from "./types";
import { hline, rect } from "./types";

export function coverPage(
  content: CoverContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  // ---------- Header ----------
  elements.push({
    type: "text",
    children: ["01 / RESEARCH BRIEF"],
    top: inches(0.3),
    left: GUTTER,
    width: inches(7),
    fontSize: TYPE.micro,
    color: COLORS.grey600,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  elements.push({
    type: "text",
    children: [content.date.toUpperCase()],
    top: inches(0.3),
    left: dims.width - GUTTER - inches(5),
    width: inches(5),
    fontSize: TYPE.micro,
    color: COLORS.grey600,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });
  elements.push(hline(inches(0.6), GUTTER, dims.width - 2 * GUTTER));

  // ---------- Vertical orange bracket (right edge, hero accent) ----------
  // Source uses x=12.20, w=0.06 (just inside the right edge), h=4.20.
  elements.push(
    rect(
      inches(1.4),
      dims.width - GUTTER - 8, // 8px from right gutter inset
      8,
      inches(4.2),
      COLORS.brand,
    ),
  );

  // ---------- Hero title ----------
  elements.push({
    type: "text",
    children: [cleanProse(content.title)],
    top: inches(1.4),
    left: GUTTER,
    width: dims.width - 2 * GUTTER - inches(0.5),
    fontSize: TYPE.display, // ~88
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });

  // ---------- Subtitle ----------
  elements.push({
    type: "text",
    children: [cleanLine(content.subtitle)],
    top: inches(4.55),
    left: GUTTER,
    width: dims.width - 2 * GUTTER - inches(0.5),
    fontSize: TYPE.bodyLarge,
    color: COLORS.grey700,
    fontRef: fonts.sans,
  });

  // ---------- Bottom divider ----------
  elements.push(hline(inches(6.15), GUTTER, dims.width - 2 * GUTTER));

  // ---------- AUTHOR / TEAM / DATE metadata mono row ----------
  // Plain text element doesn't support per-character coloring, so render
  // each label/value pair as its own element. A grey label gets a
  // black-bold value side-by-side, separated by a mono " · " on the next.
  // We approximate with a single concatenated string in mono since
  // mixing colors per-character requires richtext.
  const metaText = [
    "AUTHOR  PARALLEL RESEARCH",
    "TEAM  PARALLEL",
    `DATE  ${content.date.toUpperCase()}`,
  ].join("     ·     ");
  elements.push({
    type: "text",
    children: [metaText],
    top: inches(6.35),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });

  // ---------- Context line ----------
  elements.push({
    type: "text",
    children: ["INTERNAL BRIEF   ·   NOT FOR EXTERNAL DISTRIBUTION"],
    top: inches(6.65),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.micro,
    color: COLORS.grey600,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });

  // ---------- Footer divider + page number ----------
  elements.push(hline(inches(7.05), GUTTER, dims.width - 2 * GUTTER));
  elements.push({
    type: "text",
    children: ["PARALLEL  ·  01"],
    top: inches(7.15),
    left: dims.width - GUTTER - inches(5),
    width: inches(5),
    fontSize: TYPE.micro,
    color: COLORS.grey600,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });

  return {
    title: content.title,
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
