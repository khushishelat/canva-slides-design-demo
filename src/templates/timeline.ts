/**
 * Timeline slide.
 *
 * Renders ALL events Claude provides (no truncation to "+N in appendix").
 * With 10-14 events at 1920 wide and 116 gutter, slot widths are 130-180px
 * — tight but workable thanks to alternating above/below sides giving
 * each row vertical breathing room. Text font sizes step down as event
 * count rises so labels still fit in their slot.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand } from "./_shared";
import type { Dims, PageSpec, TimelineContent } from "./types";
import { rect } from "./types";

const CATEGORY_COLORS = [
  COLORS.brand,
  COLORS.black,
  COLORS.grey700,
  COLORS.grey500,
  COLORS.orangeTint,
  COLORS.neural,
  COLORS.grey400,
];

export function timelinePage(
  content: TimelineContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "01 / TIMELINE" }, dims, fonts));

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

  // Legend (mono uppercase, in a horizontal row)
  const legendY = inches(1.7);
  let legendX = GUTTER;
  const categoryColor = new Map<string, string>();
  content.legend.forEach((label, i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length] || COLORS.grey600;
    categoryColor.set(label, color);
    elements.push(rect(legendY + 4, legendX, 10, 10, color));
    elements.push({
      type: "text",
      children: [label.toUpperCase()],
      top: legendY,
      left: legendX + 16,
      width: inches(2.4),
      fontSize: TYPE.micro,
      color: COLORS.grey700,
      fontWeight: "medium",
      fontRef: fonts.mono,
    });
    legendX += inches(2.6);
  });

  const events = content.events;
  const slotCount = Math.max(1, events.length);

  // Axis thickness scaled up so it renders visibly at lower zoom levels.
  // Earlier 2px axis was invisible — using 4px is more robust.
  const axisY = inches(4.0);
  elements.push(
    rect(axisY, GUTTER, dims.width - 2 * GUTTER, 4, COLORS.black),
  );

  // Slot width determines text font sizes — fewer events = bigger text.
  const usableWidth = dims.width - 2 * GUTTER;
  const slotWidth = usableWidth / slotCount;
  const slotInnerPad = 12;
  const slotTextWidth = Math.max(80, slotWidth - 2 * slotInnerPad);

  // Step font sizes down as event count rises
  const titleFs =
    slotCount <= 6 ? TYPE.body : slotCount <= 9 ? TYPE.caption : TYPE.small;
  const descFs = slotCount <= 6 ? TYPE.small : TYPE.micro;

  events.forEach((evt, i) => {
    const slotLeft = GUTTER + i * slotWidth;
    const cx = slotLeft + slotWidth / 2;
    const color = categoryColor.get(evt.category) || COLORS.brand;

    // Vertical tick (taller and thicker so it stands out from the axis)
    elements.push(rect(axisY - 8, cx - 2, 4, 20, color));

    const above = evt.side === "above";

    // Date (mono, closest to axis)
    const dateY = above ? axisY - inches(0.4) : axisY + inches(0.3);
    elements.push({
      type: "text",
      children: [`${evt.month} ${evt.year}`],
      top: dateY,
      left: slotLeft + slotInnerPad,
      width: slotTextWidth,
      fontSize: TYPE.micro,
      color: COLORS.grey700,
      fontWeight: "medium",
      textAlign: "center",
      fontRef: fonts.mono,
    });

    // Title
    const titleY = above ? axisY - inches(0.95) : axisY + inches(0.6);
    elements.push({
      type: "text",
      children: [cleanLine(evt.title)],
      top: titleY,
      left: slotLeft + slotInnerPad,
      width: slotTextWidth,
      fontSize: titleFs,
      color: COLORS.black,
      fontWeight: "medium",
      textAlign: "center",
      fontRef: fonts.sans,
    });

    // Description (furthest from axis)
    const descY = above ? axisY - inches(1.85) : axisY + inches(1.0);
    elements.push({
      type: "text",
      children: [cleanProse(evt.desc)],
      top: descY,
      left: slotLeft + slotInnerPad,
      width: slotTextWidth,
      fontSize: descFs,
      color: COLORS.grey700,
      textAlign: "center",
      fontRef: fonts.sans,
    });
  });

  elements.push(
    ...footerBand(
      { source: "PUBLIC SOURCES; PARALLEL RESEARCH", pageNumber: "03" },
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
