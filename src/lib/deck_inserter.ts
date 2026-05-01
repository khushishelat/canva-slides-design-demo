/**
 * Insert an assembled deck into the Canva design via `addPage`.
 *
 * Each slide is built into a PageSpec by its registered template builder,
 * then `addPage` is called sequentially (Canva renders pages in insertion
 * order; parallelizing breaks ordering). New pages land AFTER the user's
 * current page — Canva doesn't expose a way to programmatically jump to
 * the last page, so the UX promises "appended after current page" rather
 * than "end of design."
 */
import { addPage } from "@canva/design";
import type { ElementAtPoint } from "@canva/design";
import { resolveFonts } from "src/design/tokens";
import { buildPage } from "src/templates/_registry";
import type { AssembledDeck, Dims } from "src/templates/types";

/**
 * All deck pages render at a fixed 1920×1080 (16:9 presentation size).
 *
 * Why fixed instead of adapting to the user's design dimensions:
 * pptxgenjs templates were designed at LAYOUT_WIDE (13.3" × 7.5" ≈ 1920×1080)
 * with absolute pixel coordinates. Adapting to the user's design (e.g. 800×600)
 * meant elements positioned with `left = GUTTER + inches(5.85)` overflowed
 * the page and got clamped to width=1, which made text wrap one character
 * per line ("Mordor I n s c b l r u o d a I"). Fixed dims sidesteps that
 * entirely — Canva creates each page at 1920×1080 regardless of the design's
 * default page size, so our layouts always have the canvas they were
 * designed for.
 */
const FIXED_DIMS: Dims = { width: 1920, height: 1080 };
const RATE_LIMIT_DELAY_MS = 600; // gap between addPage calls to avoid 429
const RATE_LIMIT_RETRY_DELAY_MS = 4000; // longer backoff on actual 429

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Defensively clamp every element to inside the page bounds. Canva
 * throws an opaque "invalid placement" error if any element extends
 * past the page edges, and the error doesn't say which element. This
 * runs on every PageSpec right before `addPage` and:
 *   - rounds top/left to non-negative integers
 *   - caps width so left + width <= page.width
 *   - caps height so top + height <= page.height
 *   - enforces minimum size so we don't end up with 0-px elements
 */
function clampElement(el: ElementAtPoint, dims: Dims): ElementAtPoint {
  // Cast to a permissive shape — all positionable element types share
  // the same top/left/width/height fields.
  const e = el as ElementAtPoint & {
    top?: number;
    left?: number;
    width?: number;
    height?: number;
  };
  if (e.top == null || e.left == null) return el;
  let top = Math.max(0, Math.round(e.top));
  let left = Math.max(0, Math.round(e.left));
  // Width/height are optional on text but required on shapes — leave
  // undefined as-is.
  let width = e.width;
  let height = e.height;
  if (typeof width === "number") {
    width = Math.max(1, Math.round(width));
    if (left + width > dims.width) {
      width = Math.max(1, dims.width - left);
    }
  }
  if (typeof height === "number") {
    height = Math.max(1, Math.round(height));
    if (top + height > dims.height) {
      height = Math.max(1, dims.height - top);
    }
  }
  return { ...el, top, left, ...(width != null ? { width } : {}), ...(height != null ? { height } : {}) } as ElementAtPoint;
}

export type InsertResult = {
  inserted: number;
  failed: Array<{ index: number; template_id: string; error: string }>;
};

/**
 * Sort the slides into a coherent presentation order:
 *   cover → summary → divider → body → appendix
 * Body slides keep Claude's emitted ordering relative to each other.
 */
function sortDeckSlides(deck: AssembledDeck): AssembledDeck {
  const order: Record<string, number> = {
    cover: 0,
    summary: 1,
    divider: 2,
    timeline: 3,
    callout: 4,
    brief: 5,
    matrix: 6,
    quote: 7,
    deeper_findings_table: 90,
    deeper_findings_text: 90,
    appendix: 99,
  };
  const slides = [...deck.slides].sort((a, b) => {
    const oa = order[a.template_id] ?? 50;
    const ob = order[b.template_id] ?? 50;
    return oa - ob;
  });
  return { ...deck, slides };
}

/**
 * Add one page with retry-on-rate-limit. Canva returns "Add page rate
 * limit exceeded" when we burst-add too many pages back-to-back; sleeping
 * a few seconds and retrying once usually clears it.
 */
async function addPageWithRetry(opts: Parameters<typeof addPage>[0]): Promise<void> {
  try {
    await addPage(opts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("rate limit")) {
      // eslint-disable-next-line no-console
      console.warn(
        `[insertDeck] rate limit hit, sleeping ${RATE_LIMIT_RETRY_DELAY_MS}ms and retrying`,
      );
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      await addPage(opts);
    } else {
      throw err;
    }
  }
}

/**
 * Insert each slide as a new page. If a single page fails, we log the
 * error and continue with the rest — the user gets as many slides as
 * Canva will accept rather than just whatever made it before the first
 * error. Returns a summary the UI can show.
 */
export async function insertDeck(deck: AssembledDeck): Promise<InsertResult> {
  const sorted = sortDeckSlides(deck);
  const fonts = await resolveFonts();
  const dims = FIXED_DIMS;
  const result: InsertResult = { inserted: 0, failed: [] };
  for (let i = 0; i < sorted.slides.length; i++) {
    const slide = sorted.slides[i];
    if (!slide || !slide.content) continue;
    try {
      const page = buildPage(slide, dims, fonts);
      const safeElements = page.elements.map((el) => clampElement(el, dims));
      await addPageWithRetry({
        title: page.title,
        background: page.background,
        elements: safeElements,
        dimensions: dims,
      });
      result.inserted++;
      // Throttle between successful inserts so we don't trigger Canva's
      // burst rate limiter on the NEXT page.
      if (i < sorted.slides.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[insertDeck] slide ${i + 1} (${slide.template_id}) failed:`,
        msg,
      );
      result.failed.push({
        index: i + 1,
        template_id: slide.template_id,
        error: msg,
      });
    }
  }
  return result;
}
