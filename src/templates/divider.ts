/**
 * Section divider — port of build_divider_slide.js (dark mode).
 *
 * Layout (background: Index black):
 *   - Mono kicker top-left ("PART · 02")
 *   - "PARALLEL · MACHINE MODE" mono top-right (note: machine mode, not human)
 *   - Thin grey-800 divider beneath
 *   - HUGE mono signal-orange chapter number on the left (visual hero)
 *   - Chapter title (multi-line) below the chapter number, off-white sans
 *   - Dek subtitle in muted grey under the title
 *   - "IN THIS SECTION" mono kicker on the RIGHT, with bullets below as
 *     orange-arrow + label rows
 *   - Footer: "FOLLOWING SECTION · N SLIDES" + page number
 *
 * Earlier I just rendered "§" + "SECTION" — way less impactful than the
 * source design's massive orange chapter number.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse } from "./_shared";
import type { Dims, DividerContent, PageSpec } from "./types";
import { hline, rect } from "./types";

export function dividerPage(
  content: DividerContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  // ---------- Header (off-white mono on dark) ----------
  elements.push({
    type: "text",
    children: ["PART  ·  SECTION"],
    top: inches(0.3),
    left: GUTTER,
    width: inches(7),
    fontSize: TYPE.micro,
    color: COLORS.grey500,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  elements.push({
    type: "text",
    children: ["PARALLEL  ·  MACHINE MODE"],
    top: inches(0.3),
    left: dims.width - GUTTER - inches(5),
    width: inches(5),
    fontSize: TYPE.micro,
    color: COLORS.grey500,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });
  elements.push(hline(inches(0.6), GUTTER, dims.width - 2 * GUTTER, COLORS.grey800));

  // ---------- Massive chapter number (visual hero) ----------
  // Source uses fontSize 180 — Canva caps at 100, so we render at 100 (still
  // dominant against the surrounding type). Mono, signal orange, left-aligned.
  // Use "01" as a default since we don't have a chapter number in the schema;
  // the chapterTitle carries the meaning.
  elements.push({
    type: "text",
    children: ["§"],
    top: inches(1.05),
    left: GUTTER,
    width: inches(5),
    fontSize: 100,
    color: COLORS.brand,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });

  // ---------- Chapter title (off-white sans) ----------
  elements.push({
    type: "text",
    children: [cleanLine(content.chapterTitle)],
    top: inches(4.1),
    left: GUTTER,
    width: inches(8.5),
    fontSize: TYPE.display,
    color: COLORS.offWhite,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });

  // ---------- Dek subtitle ----------
  elements.push({
    type: "text",
    children: [cleanProse(content.dek)],
    top: inches(5.7),
    left: GUTTER,
    width: inches(7.5),
    fontSize: TYPE.bodyLarge,
    color: COLORS.grey400,
    fontRef: fonts.sans,
  });

  // ---------- Right-side bullet list with orange arrows ----------
  const bulletStartX = inches(9.0);
  const bulletStartY = inches(4.1);
  const bulletStep = inches(0.55);

  elements.push({
    type: "text",
    children: ["IN THIS SECTION"],
    top: bulletStartY - inches(0.42),
    left: bulletStartX,
    width: inches(4),
    fontSize: TYPE.micro,
    color: COLORS.grey500,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });

  content.bullets.slice(0, 5).forEach((b, i) => {
    const y = bulletStartY + i * bulletStep;
    // Orange "→" arrow
    elements.push({
      type: "text",
      children: ["→"],
      top: y,
      left: bulletStartX,
      width: inches(0.5),
      fontSize: TYPE.bodyLarge,
      color: COLORS.brand,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });
    // Bullet label
    elements.push({
      type: "text",
      children: [cleanLine(b)],
      top: y,
      left: bulletStartX + inches(0.5),
      width: inches(3.5),
      fontSize: TYPE.body,
      color: COLORS.offWhite,
      fontRef: fonts.sans,
    });
  });

  // ---------- Footer (dark-mode bottom divider + meta) ----------
  elements.push(hline(inches(7.0), GUTTER, dims.width - 2 * GUTTER, COLORS.grey800));
  elements.push({
    type: "text",
    children: ["FOLLOWING SECTION"],
    top: inches(7.05),
    left: GUTTER,
    width: inches(8),
    fontSize: TYPE.micro,
    color: COLORS.grey500,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  elements.push({
    type: "text",
    children: ["PARALLEL  ·  SECTION"],
    top: inches(7.05),
    left: dims.width - GUTTER - inches(5),
    width: inches(5),
    fontSize: TYPE.micro,
    color: COLORS.grey500,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });

  // Suppress unused-var warning for rect (kept import for future thumbnails)
  void rect;

  return {
    title: content.chapterTitle,
    background: { color: COLORS.black },
    elements,
    dimensions: dims,
  };
}
