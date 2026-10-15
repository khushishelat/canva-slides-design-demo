/**
 * One visual subject → a short, ranked list of images Canva can actually
 * upload, each tagged with where it came from.
 *
 * Pipeline:
 *   1. Parallel Image Search (`advanced`, so results carry dimensions)
 *   2. Drop stock-agency results — they're watermarked/licensed, and stock
 *      is the one thing Canva already has plenty of.
 *   3. Pre-flight every URL: it must load (200) as JPEG/PNG/WebP and be
 *      big enough for a slide, reading just enough bytes to measure
 *      dimensions when the search result didn't include them.
 *   4. Rank: first-party sources (the subject's own domains) first, then
 *      Parallel's relevance order, nudged by resolution and slide-friendly
 *      aspect ratio.
 *
 * Inserting goes through `fetchImageForUpload`: the backend downloads the
 * picked image and returns it as a data URL. Canva's `upload()` would
 * otherwise re-fetch the web URL itself and require it to not redirect and
 * to serve a Content-Type matching what we declare — which breaks on the
 * many image CDNs that negotiate JPEG vs WebP per request.
 */
import { imageSize } from "image-size";
import { imageSearch, type ImageSearchResult } from "./parallel_client";
import type { VisualSubject } from "./visual_subjects";

const SEARCH_MAX_RESULTS = 12;
const RETURN_PER_SUBJECT = 6;
const PREFLIGHT_TIMEOUT_MS = 4000;
const PREFLIGHT_MAX_BYTES = 512 * 1024;
/** Canva caps data URLs at 10M chars; base64 inflates bytes by 4/3. */
const DATA_URL_MAX_BYTES = 7 * 1024 * 1024;

/** Ask for JPEG/PNG so CDNs that negotiate formats don't hand us WebP. */
const IMAGE_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ParallelCanvaDemo/1.0)",
  Accept: "image/jpeg,image/png;q=0.9,image/*;q=0.5,*/*;q=0.1",
};

/** Image types Canva's upload() accepts that we're willing to insert. */
const UPLOADABLE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** image-size `type` → MIME, for the same three formats. */
const SNIFFED_MIME: Record<string, ImageCandidate["mime_type"]> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
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

  return {
    subject_id: subject.id,
    search_id: search.search_id,
    images: ok.slice(0, RETURN_PER_SUBJECT).map((r) => r.candidate),
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
  const url = toUploadableUrl(r.image_url);
  if (!url) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: IMAGE_FETCH_HEADERS,
    });
    if (res.status !== 200) return null;

    const headerMime =
      (res.headers.get("content-type") || "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    // Some newsrooms serve real JPEGs as application/octet-stream; sniff those.
    const generic = /^(application|binary)\/octet-stream$|^$/.test(headerMime);
    if (!UPLOADABLE_MIME.has(headerMime) && !generic) return null;

    const len = Number(res.headers.get("content-length") || 0);
    if (len > DATA_URL_MAX_BYTES) return null;

    let mime = UPLOADABLE_MIME.has(headerMime)
      ? (headerMime as ImageCandidate["mime_type"])
      : undefined;
    let width = r.width ?? 0;
    let height = r.height ?? 0;
    if (!mime || !width || !height) {
      const head = await readHead(res, PREFLIGHT_MAX_BYTES);
      try {
        const dims = imageSize(head);
        mime = mime ?? (dims.type ? SNIFFED_MIME[dims.type] : undefined);
        if (!width || !height) {
          width = dims.width ?? 0;
          height = dims.height ?? 0;
        }
      } catch {
        return null;
      }
    }
    // Too small to hold up on a slide.
    if (!mime || width < 600 || height < 340) return null;

    const sourceHost = hostOf(r.source_page_url);
    const provenance = classify([sourceHost, hostOf(url)], officialDomains);

    return {
      candidate: {
        image_url: url,
        source_page_url: r.source_page_url,
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
  } finally {
    clearTimeout(timer);
    ctrl.abort();
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

/** HTTPS only (http is upgraded); no bare IPs. Null if unusable. */
function toUploadableUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/^http:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) return null;
  return u.toString();
}

export type FetchedImage = {
  data_url: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

/**
 * Download one picked image and return it as a data URL for Canva's
 * `upload()`. The MIME type comes from the bytes, not the response header.
 */
export async function fetchImageForUpload(
  rawUrl: string,
): Promise<FetchedImage> {
  const url = toUploadableUrl(rawUrl);
  if (!url) throw new Error("Unsupported image URL");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: IMAGE_FETCH_HEADERS,
    });
    if (res.status !== 200)
      throw new Error(`Image host returned ${res.status}`);
    const bytes = await readHead(res, DATA_URL_MAX_BYTES + 1);
    if (bytes.length > DATA_URL_MAX_BYTES)
      throw new Error("Image is too large");

    const dims = imageSize(bytes);
    const mime = dims.type ? SNIFFED_MIME[dims.type] : undefined;
    if (!mime || !dims.width || !dims.height) {
      throw new Error(`Unsupported image type: ${dims.type ?? "unknown"}`);
    }
    return {
      data_url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      mime_type: mime,
      width: dims.width,
      height: dims.height,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readHead(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  void reader.cancel().catch(() => undefined);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
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
