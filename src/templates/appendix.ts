/**
 * Citations appendix — port of build_appendix_slide.js
 * Two-column numbered list, mono font, with hyperlinked URLs.
 *
 * Note: Canva text elements don't support per-character links via the
 * normal text type — they need richtext for that. To keep this layout
 * file simple, we render plain text and the URLs go into the citation
 * modal via the slide's `citations` array on the AssembledSlide.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { footerBand, headerBand } from "./_shared";
import type { AppendixContent, Dims, PageSpec } from "./types";
import { hline } from "./types";

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "").slice(0, 50);
  } catch {
    return url.slice(0, 60);
  }
}

export function appendixPage(
  content: AppendixContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "APPENDIX / CITATIONS" }, dims, fonts));

  // Title
  elements.push({
    type: "text",
    children: ["References"],
    top: inches(0.78),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.sectionTitle,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });
  elements.push(hline(inches(1.65), GUTTER, dims.width - 2 * GUTTER));

  // Two columns of numbered citations
  const colW = (dims.width - 2 * GUTTER - inches(0.5)) / 2;
  const startY = inches(1.85);
  const rowH = inches(0.55);
  const cites = content.citations.slice(0, 14);
  const half = Math.ceil(cites.length / 2);

  cites.forEach((c, i) => {
    const col = i < half ? 0 : 1;
    const rowIdx = i - col * half;
    const x = GUTTER + col * (colW + inches(0.5));
    const y = startY + rowIdx * rowH;
    // Number
    elements.push({
      type: "text",
      children: [`[${i + 1}]`],
      top: y,
      left: x,
      width: inches(0.5),
      fontSize: TYPE.small,
      color: COLORS.brand,
      fontWeight: "medium",
      fontRef: fonts.mono,
    });
    // Title + publication line
    const headLine = c.publication ? `${c.title} — ${c.publication}` : c.title;
    elements.push({
      type: "text",
      children: [headLine],
      top: y,
      left: x + inches(0.5),
      width: colW - inches(0.5),
      fontSize: TYPE.small,
      color: COLORS.black,
      fontRef: fonts.sans,
    });
    // Date + URL
    const subLine = [c.date, shortUrl(c.url)].filter(Boolean).join("  ·  ");
    elements.push({
      type: "text",
      children: [subLine],
      top: y + inches(0.22),
      left: x + inches(0.5),
      width: colW - inches(0.5),
      fontSize: TYPE.micro,
      color: COLORS.grey600,
      fontRef: fonts.mono,
    });
  });

  elements.push(
    ...footerBand({ source: "VERIFIABLE PUBLIC SOURCES", pageNumber: String(99).padStart(2, "0") }, dims, fonts),
  );

  return {
    title: "References",
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
