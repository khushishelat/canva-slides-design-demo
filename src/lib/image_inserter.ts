/**
 * Put a web image on the current page with its source credited.
 *
 * Two modes:
 *   - Replace: if the user has an image selected (e.g. a template's
 *     placeholder photo), swap its content for the new image — the frame,
 *     crop and position stay as designed — and add a small source credit
 *     next to the frame (see `creditSpotFor`).
 *   - Insert: otherwise, add the image plus its credit as one group so the
 *     credit travels with the image:
 *
 *   ┌───────────────────────┐
 *   │                       │
 *   │        image          │   right half of the page, vertically centered,
 *   │                       │   <= 46% page width / 70% page height
 *   └───────────────────────┘
 *   Source: nvidianews.nvidia.com      ← small grey, linked to the source page
 *
 * The image bytes come from our backend as a data URL (see
 * backend/lib/image_candidates.ts for why we don't hand Canva the web URL).
 * Canva's queued-upload thumbnail must be JPEG/PNG, so we draw a small JPEG
 * thumbnail on a canvas — that also covers WebP originals.
 */
import { upload } from "@canva/asset";
import {
  addElementAtPoint,
  createRichtextRange,
  getCurrentPageContext,
  openDesign,
} from "@canva/design";
import type {
  DesignEditing,
  FontRef,
  ImageRef,
  SelectionEvent,
} from "@canva/design";
import { fetchImageData } from "src/api/api";
import { COLORS } from "src/design/tokens";
import type { ImageCandidate } from "src/types";

export type ImageInsertStyle = {
  /** Font detected from the user's design, used for the credit line. */
  fontRef?: FontRef;
  /** Credit text color; defaults to grey. */
  color?: string;
};

export async function insertImage(
  candidate: ImageCandidate,
  subjectLabel: string,
  style: ImageInsertStyle = {},
  /** Current image selection; when non-empty, replace instead of insert. */
  replaceTarget?: SelectionEvent<"image">,
): Promise<void> {
  const fetched = await fetchImageData(candidate.image_url);
  const thumbnailUrl = await jpegThumbnail(fetched.data_url, 480);
  const host = candidate.source_host || hostOf(candidate.image_url);

  const asset = await upload({
    type: "image",
    mimeType: fetched.mime_type,
    url: fetched.data_url,
    thumbnailUrl,
    // No `name`: the SDK types accept it, but the editor currently fails
    // the upload with internal_error when it's set.
    // Retrieved from the web as-is — not generated or altered.
    aiDisclosure: "none",
  });
  // upload() resolves once queued; processing failures only surface here.
  // Wait so a rejected image shows as an error on its tile instead of a
  // broken placeholder on the slide.
  await asset.whenUploaded();

  const altText = {
    text: candidate.title || subjectLabel,
    decorative: false,
  };

  const page = await getCurrentPageContext();
  const dims = page.dimensions;

  if (replaceTarget && replaceTarget.count > 0) {
    const draft = await replaceTarget.read();
    for (const content of draft.contents) content.ref = asset.ref;
    await draft.save();
    if (dims) {
      const size = Math.max(10, Math.round(dims.width / 120));
      const spot = await creditSpotFor(asset.ref, dims, size);
      await addElementAtPoint({
        type: "richtext",
        range: creditRange(host, candidate.source_page_url, size, spot.align, {
          ...style,
          color: spot.color,
        }),
        top: spot.top,
        left: spot.left,
        width: spot.width,
      });
    }
    return;
  }

  if (!dims) {
    // Pages without dimensions (e.g. whiteboards): let Canva place it.
    await addElementAtPoint({ type: "image", ref: asset.ref, altText });
    return;
  }

  // ---------- Layout ----------
  const margin = Math.round(dims.width * 0.04);
  const scale = Math.min(
    (dims.width * 0.46) / fetched.width,
    (dims.height * 0.7) / fetched.height,
  );
  const w = Math.round(fetched.width * scale);
  const h = Math.round(fetched.height * scale);
  const creditSize = Math.max(10, Math.round(dims.width / 110));
  const creditGap = Math.round(creditSize * 0.6);
  const groupHeight = h + creditGap + Math.round(creditSize * 1.4);
  const left = dims.width - margin - w;
  const top = Math.max(margin, Math.round((dims.height - groupHeight) / 2));

  const credit = creditRange(
    host,
    candidate.source_page_url,
    creditSize,
    "start",
    style,
  );

  try {
    await addElementAtPoint({
      type: "group",
      top,
      left,
      width: w,
      height: "auto",
      children: [
        {
          type: "image",
          ref: asset.ref,
          altText,
          top: 0,
          left: 0,
          width: w,
          height: h,
        },
        {
          type: "richtext",
          range: credit,
          top: h + creditGap,
          left: 0,
          width: w,
        },
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[insertImage] group insert failed, inserting separately",
      err,
    );
    await addElementAtPoint({
      type: "image",
      ref: asset.ref,
      altText,
      top,
      left,
      width: w,
      height: h,
    });
    await addElementAtPoint({
      type: "richtext",
      range: credit,
      top: top + h + creditGap,
      left,
      width: w,
    });
  }
}

type Box = { top: number; left: number; width: number; height: number };
type CreditSpot = Box & { align: "start" | "end"; color: string };

/**
 * Where to put the credit for a replaced image. The selection API only
 * gives us image refs, so read the page to find the frame now holding
 * `ref`, then try, in order:
 *   1. directly under the frame (left-aligned)
 *   2. directly above the frame (right-aligned)
 *   3. inside the frame's bottom edge, in white
 * skipping any spot that leaves the page or overlaps another element
 * (full-page backgrounds don't count). Falls back to the page's
 * bottom-right corner if the frame can't be found.
 */
async function creditSpotFor(
  ref: ImageRef,
  dims: { width: number; height: number },
  size: number,
): Promise<CreditSpot> {
  let frame: Box | undefined;
  const obstacles: Box[] = [];
  await openDesign({ type: "current_page" }, async (session) => {
    if (session.page.type !== "absolute") return;
    session.page.elements.forEach((el) => {
      const box = {
        top: el.top,
        left: el.left,
        width: el.width,
        height: el.height,
      };
      if (!frame && holdsImage(el, ref)) frame = box;
      else if (box.width * box.height < 0.9 * dims.width * dims.height) {
        obstacles.push(box);
      }
    });
  });

  const h = Math.round(size * 1.6);
  const gap = Math.round(size * 0.5);
  if (!frame) {
    const margin = Math.round(dims.width * 0.02);
    const width = Math.round(dims.width * 0.4);
    return {
      top: dims.height - margin - h,
      left: dims.width - margin - width,
      width,
      height: h,
      align: "end",
      color: COLORS.grey700,
    };
  }
  const f = frame;
  const candidates: CreditSpot[] = [
    {
      top: f.top + f.height + gap,
      left: f.left,
      width: f.width,
      height: h,
      align: "start",
      color: COLORS.grey700,
    },
    {
      top: f.top - gap - h,
      left: f.left,
      width: f.width,
      height: h,
      align: "end",
      color: COLORS.grey700,
    },
  ];
  const fits = (c: Box) =>
    c.top >= 0 &&
    c.left >= 0 &&
    c.top + c.height <= dims.height &&
    c.left + c.width <= dims.width &&
    !obstacles.some((o) => overlaps(c, o));
  return (
    candidates.find(fits) ?? {
      top: f.top + f.height - gap - h,
      left: f.left + gap,
      width: f.width - 2 * gap,
      height: h,
      align: "start",
      color: COLORS.white,
    }
  );
}

function holdsImage(el: DesignEditing.AbsoluteElement, ref: ImageRef): boolean {
  const isRef = (m: DesignEditing.MediaFill | undefined) =>
    m?.type === "image" && m.imageRef === ref;
  if (el.type === "rect") return isRef(el.fill.mediaContainer.ref);
  if (el.type === "shape") {
    let hit = false;
    el.paths.forEach((p) => {
      if (isRef(p.fill.mediaContainer.ref)) hit = true;
    });
    return hit;
  }
  return false;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** "Source: <host>", small and grey, with the host linked to the source page. */
function creditRange(
  host: string,
  sourcePageUrl: string | null,
  fontSize: number,
  textAlign: "start" | "end",
  style: ImageInsertStyle,
) {
  const label = "Source: ";
  const range = createRichtextRange();
  range.appendText(`${label}${host}`);
  range.formatParagraph(
    { index: 0, length: label.length + host.length },
    {
      fontSize,
      color: style.color || COLORS.grey700,
      textAlign,
      ...(style.fontRef ? { fontRef: style.fontRef } : {}),
    },
  );
  if (sourcePageUrl) {
    range.formatText(
      { index: label.length, length: host.length },
      { link: sourcePageUrl, decoration: "underline" },
    );
  }
  return range;
}

/** Downscale any image data URL to a JPEG thumbnail (Canva needs JPEG/PNG). */
function jpegThumbnail(dataUrl: string, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * s));
      canvas.height = Math.max(1, Math.round(img.height * s));
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
