/**
 * Callout slide — port of build_callout_slide.js
 * Three big-stat callouts side-by-side. Each cell:
 *   - Orange accent tab top-left
 *   - Eyebrow (mono)
 *   - Big number (rich-text composition: prefix + number + suffix)
 *   - Qualifier (mono uppercase, orange)
 *   - Headline (sans, bold)
 *   - Description (sans, smaller, grey)
 *   - SOURCE label + citation row
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand } from "./_shared";
import type { CalloutContent, Dims, PageSpec } from "./types";
import { rect, vline, hline } from "./types";

export function calloutPage(
  content: CalloutContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "02 / STATISTICS · CALLOUT" }, dims, fonts));

  // Title
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

  // Dek
  elements.push({
    type: "text",
    children: [cleanProse(content.dek)],
    top: inches(1.75),
    left: GUTTER,
    width: inches(9.0),
    fontSize: TYPE.caption,
    color: COLORS.grey700,
    fontRef: fonts.sans,
  });
  elements.push(hline(inches(2.55), GUTTER, dims.width - 2 * GUTTER));

  // 3 stat cells
  const cellY = inches(2.8);
  const cellH = inches(3.85);
  const innerW = dims.width - 2 * GUTTER;
  const cellW = innerW / 3;

  content.stats.slice(0, 3).forEach((s, i) => {
    const cellX = GUTTER + i * cellW;
    const padX = inches(0.3);

    // Vertical separator between cells
    if (i < 2) {
      elements.push(
        vline(cellY + inches(0.2), cellX + cellW, cellH - inches(0.4), COLORS.grey400),
      );
    }

    // Orange accent tab
    elements.push(rect(cellY, cellX + padX, inches(0.4), 4, COLORS.brand));

    // Eyebrow
    if (s.eyebrow) {
      elements.push({
        type: "text",
        children: [s.eyebrow],
        top: cellY + inches(0.15),
        left: cellX + padX,
        width: cellW - 2 * padX,
        fontSize: TYPE.micro,
        color: COLORS.grey700,
        fontWeight: "medium",
        fontRef: fonts.mono,
      });
    }

    // Big number (concat prefix + number + suffix, all in one text element)
    const numStr = `${s.prefix || ""}${s.number}${s.suffix || ""}`;
    elements.push({
      type: "text",
      children: [numStr],
      top: cellY + inches(0.55),
      left: cellX + padX,
      width: cellW - 2 * padX,
      fontSize: TYPE.hero,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });

    // Qualifier
    if (s.qualifier) {
      elements.push({
        type: "text",
        children: [s.qualifier],
        top: cellY + inches(2.2),
        left: cellX + padX,
        width: cellW - 2 * padX,
        fontSize: TYPE.micro,
        color: COLORS.brand,
        fontWeight: "medium",
        fontRef: fonts.mono,
      });
    }

    // Headline
    elements.push({
      type: "text",
      children: [cleanProse(s.headline)],
      top: cellY + inches(2.5),
      left: cellX + padX,
      width: cellW - 2 * padX,
      fontSize: TYPE.body,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });

    // Description
    elements.push({
      type: "text",
      children: [cleanProse(s.desc)],
      top: cellY + inches(3.0),
      left: cellX + padX,
      width: cellW - 2 * padX,
      fontSize: TYPE.caption,
      color: COLORS.grey700,
      fontRef: fonts.sans,
    });
  });

  elements.push(
    ...footerBand({ source: "SOURCES AS NOTED · PARALLEL ANALYSIS", pageNumber: "05" }, dims, fonts),
  );

  return {
    title: content.title,
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
