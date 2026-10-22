/**
 * One visual subject → a short, ranked list of images Canva can actually
 * upload, each tagged with where it came from.
 *
 * Pipeline:
 *   1. Parallel Image Search (`advanced`, so results carry dimensions)
 *   2. Drop stock-agency results — they're watermarked/licensed, and stock
 *      is the one thing Canva already has plenty of.
 *   3. Pre-flight every URL: it must load (200) as JPEG/PNG/WebP and be
 *      big enough for a slide, reading at most 256 KB to check the format
 *      and measure dimensions when the search result didn't include them.
 *   4. Rank: first-party sources (the subject's own domains) first, then
 *      Parallel's relevance order, nudged by resolution and slide-friendly
 *      aspect ratio.
 *
 * Inserting goes through `fetchImageForUpload`: the backend downloads the
 * picked image and returns it as a data URL. Canva's `upload()` would
 * otherwise re-fetch the web URL itself and require it to not redirect and
 * to serve a Content-Type matching what we declare — which breaks on the
 * many image CDNs that negotiate JPEG vs WebP per request.
 *
 * Safety: every request goes through `safeGet` (public addresses only), and
 * `fetchImageForUpload` only accepts URLs this server returned from a search
 * in the last 30 minutes — it is not a general-purpose fetch proxy. Bytes
 * are only parsed after their magic number says JPEG/PNG/WebP.
 */
import { imageSize } from "image-size";
import { imageSearch, type ImageSearchResult } from "./parallel_client";
import { safeGet } from "./safe_fetch";
import type { VisualSubject } from "./visual_subjects";

const SEARCH_MAX_RESULTS = 12;
const RETURN_PER_SUBJECT = 6;
const PREFLIGHT_TIMEOUT_MS = 4000;
const PREFLIGHT_MAX_BYTES = 256 * 1024;
const UPLOAD_FETCH_TIMEOUT_MS = 15000;
/** How long a search result stays fetchable via fetchImageForUpload. */
const ISSUED_TTL_MS = 30 * 60 * 1000;
/** Canva caps data URLs at 10M chars; base64 inflates bytes by 4/3. */
const DATA_URL_MAX_BYTES = 7 * 1024 * 1024;

/** Ask for JPEG/PNG so CDNs that negotiate formats don't hand us WebP. */
const IMAGE_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ParallelCanvaDemo/1.0)",
  Accept: "image/jpeg,image/png;q=0.9,image/*;q=0.5,*/*;q=0.1",
};

/**
 * Stock agencies and "free PNG" aggregators. Results from these are either
 * watermarked comps or re-hosted images with unclear rights.
 */
const STOCK_HOSTS = [
  "gettyimages.com",
  "istockphoto.com",
  "shutterstock.com",
  "alamy.com",
  "dreamstime.com",
  "depositphotos.com",
  "123rf.com",
  "stock.adobe.com",
  "ftcdn.net",
  "vecteezy.com",
  "freepik.com",
  "pngtree.com",
  "pngwing.com",
  "pngegg.com",
  "pngitem.com",
  "cleanpng.com",
  "kindpng.com",
  "freepnglogo.com",
  "pngate.com",
  "pinimg.com",
  "pinterest.com",
];

export type Provenance = "official" | "commons" | "web";

export type ImageCandidate = {
  image_url: string;
  source_page_url: string | null;
  source_host: string | null;
  title: string | null;
  width: number;
  height: number;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  provenance: Provenance;
};

export type SubjectImages = {
  subject_id: string;
  search_id: string;
  images: ImageCandidate[];
  /** Funnel counts, surfaced in the UI so the filtering is visible. */
  counts: { returned: number; stock_dropped: number; not_uploadable: number };
};

export async function findImagesForSubject(
  subject: VisualSubject,
  sessionId: string | undefined,
): Promise<SubjectImages> {
  const search = await imageSearch({
    search_queries: subject.search_queries,
    objective: subject.objective,
    mode: "advanced",
    session_id: sessionId,
    advanced_settings: { max_results: SEARCH_MAX_RESULTS },
  });

  const seen = new Set<string>();
  const unique = search.results.filter((r) => {
    const key = dedupeKey(r.image_url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const notStock = unique.filter(
    (r) => !isStock(r.image_url) && !isStock(r.source_page_url),
  );

  const checked = await Promise.all(
    notStock.map((r, rank) => preflight(r, rank, subject.official_domains)),
  );
  const ok = checked.filter((c): c is Ranked => c != null);
  ok.sort((a, b) => b.score - a.score);

  const images = ok.slice(0, RETURN_PER_SUBJECT).map((r) => r.candidate);
  issue(images.map((i) => i.image_url));

  return {
    subject_id: subject.id,
    search_id: search.search_id,
    images,
    counts: {
      returned: search.results.length,
      stock_dropped: unique.length - notStock.length,
      not_uploadable: notStock.length - ok.length,
    },
  };
}

type Ranked = { candidate: ImageCandidate; score: number };

async function preflight(
  r: ImageSearchResult,
  rank: number,
  officialDomains: string[],
): Promise<Ranked | null> {
  const url = normalizeUrl(r.image_url);
  if (!url) return null;

  try {
    const res = await safeGet(url, {
      maxBytes: PREFLIGHT_MAX_BYTES,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
      headers: IMAGE_FETCH_HEADERS,
    });
    if (res.status !== 200) return null;

    const len = Number(res.headers["content-length"] || 0);
    if (len > DATA_URL_MAX_BYTES) return null;

    // Trust the bytes, not the Content-Type (some newsrooms serve JPEGs as
    // application/octet-stream).
    const mime = sniffMime(res.body);
    if (!mime) return null;

    let width = r.width ?? 0;
    let height = r.height ?? 0;
    if (!width || !height) {
      try {
        const dims = imageSize(res.body);
        width = dims.width ?? 0;
        height = dims.height ?? 0;
      } catch {
        return null;
      }
    }
    // Too small to hold up on a slide.
    if (width < 600 || height < 340) return null;

    const sourcePage = normalizeUrl(r.source_page_url, false);
    const sourceHost = hostOf(sourcePage);
    const provenance = classify([sourceHost, hostOf(url)], officialDomains);

    return {
      candidate: {
        image_url: url,
        source_page_url: sourcePage,
        source_host: sourceHost,
        title: r.title,
        width,
        height,
        mime_type: mime,
        provenance,
      },
      score: score(rank, width, height, provenance),
    };
  } catch {
    return null;
  }
}

function score(
  rank: number,
  width: number,
  height: number,
  provenance: Provenance,
): number {
  let s = 100 - rank * 5; // Parallel's relevance order is the backbone
  if (provenance === "official") s += 60;
  if (provenance === "commons") s += 15;
  const minSide = Math.min(width, height);
  if (minSide >= 1000) s += 15;
  else if (minSide >= 600) s += 8;
  else s -= 15;
  const aspect = width / height;
  if (aspect >= 1.2 && aspect <= 2.2) s += 8; // fits a 16:9 slide well
  return s;
}

function classify(hosts: (string | null)[], official: string[]): Provenance {
  for (const h of hosts) {
    if (!h) continue;
    if (official.some((d) => h === d || h.endsWith(`.${d}`))) {
      return "official";
    }
  }
  for (const h of hosts) {
    if (h && (h.endsWith("wikimedia.org") || h.endsWith("wikipedia.org"))) {
      return "commons";
    }
  }
  return "web";
}

/**
 * Parse and normalize a web URL; http is upgraded to https for images.
 * Null for anything that isn't http(s). (Network-level checks — public
 * addresses only — happen in safeGet.)
 */
function normalizeUrl(raw: string | null, upgrade = true): string | null {
  if (!raw) return null;
  try {
    const u = new URL(upgrade ? raw.replace(/^http:\/\//i, "https://") : raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Only these three formats ever reach the image parser. */
function sniffMime(b: Uint8Array): ImageCandidate["mime_type"] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

// ----- Issued URLs: fetchImageForUpload only serves search results -----

const issued = new Map<string, number>();

function issue(urls: string[]): void {
  const now = Date.now();
  for (const [url, expires] of issued) if (expires < now) issued.delete(url);
  for (const url of urls) issued.set(url, now + ISSUED_TTL_MS);
}

function wasIssued(url: string): boolean {
  const expires = issued.get(url);
  return expires !== undefined && expires >= Date.now();
}

export type FetchedImage = {
  data_url: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

/**
 * Download one picked image and return it as a data URL for Canva's
 * `upload()`. Only URLs returned by a recent search are accepted. The MIME
 * type comes from the bytes, not the response header.
 */
export async function fetchImageForUpload(
  rawUrl: string,
): Promise<FetchedImage> {
  const url = normalizeUrl(rawUrl);
  if (!url || !wasIssued(url)) {
    throw new Error("Unknown image — run the search again");
  }

  const res = await safeGet(url, {
    maxBytes: DATA_URL_MAX_BYTES + 1,
    timeoutMs: UPLOAD_FETCH_TIMEOUT_MS,
    headers: IMAGE_FETCH_HEADERS,
  });
  if (res.status !== 200) throw new Error(`Image host returned ${res.status}`);
  if (res.truncated || res.body.length > DATA_URL_MAX_BYTES) {
    throw new Error("Image is too large");
  }

  const mime = sniffMime(res.body);
  if (!mime) throw new Error("Unsupported image type");
  const dims = imageSize(res.body);
  if (!dims.width || !dims.height) throw new Error("Unreadable image");
  return {
    data_url: `data:${mime};base64,${res.body.toString("base64")}`,
    mime_type: mime,
    width: dims.width,
    height: dims.height,
  };
}

function isStock(url: string | null): boolean {
  const h = hostOf(url);
  return !!h && STOCK_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return url;
  }
}
