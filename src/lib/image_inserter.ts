/**
 * Insert a web image onto the current page with its source credited
 * underneath, as one group so the credit travels with the image.
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
} from "@canva/design";
import type { FontRef } from "@canva/design";
import { fetchImageData } from "src/api/api";
import { COLORS } from "src/design/tokens";
import type { ImageCandidate } from "src/types";

export type ImageInsertStyle = {
  /** Font detected from the user's design, used for the credit line. */
  fontRef?: FontRef;
};

export async function insertImage(
  candidate: ImageCandidate,
  subjectLabel: string,
  style: ImageInsertStyle = {},
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

  // ---------- Credit line ----------
  const label = "Source: ";
  const credit = createRichtextRange();
  credit.appendText(`${label}${host}`);
  credit.formatParagraph(
    { index: 0, length: label.length + host.length },
    {
      fontSize: creditSize,
      color: COLORS.grey700,
      textAlign: "start",
      ...(style.fontRef ? { fontRef: style.fontRef } : {}),
    },
  );
  if (candidate.source_page_url) {
    credit.formatText(
      { index: label.length, length: host.length },
      { link: candidate.source_page_url, decoration: "underline" },
    );
  }

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
