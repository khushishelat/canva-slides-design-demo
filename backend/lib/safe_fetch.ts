/**
 * GET a URL from the public internet only.
 *
 * The image routes fetch URLs that ultimately come from the web (search
 * results and the redirects they lead to), so every connection is checked:
 *   - http/https on the default ports only
 *   - IP-literal hosts are rejected
 *   - DNS answers are validated inside the socket's own lookup, so the
 *     address that's checked is the address that's connected to (no
 *     resolve-then-rebind gap)
 *   - redirects are followed manually and each hop is re-checked
 *   - the body is capped at `maxBytes` and the whole request at `timeoutMs`
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export type SafeResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Up to `maxBytes` of the body. */
  body: Buffer;
  /** True if the body was cut off at `maxBytes`. */
  truncated: boolean;
};

export async function safeGet(
  rawUrl: string,
  opts: {
    maxBytes: number;
    timeoutMs: number;
    headers?: Record<string, string>;
    maxRedirects?: number;
  },
): Promise<SafeResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  let url = checkUrl(rawUrl);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const res = await getOnce(url, opts.maxBytes, deadline, opts.headers);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = checkUrl(new URL(location, url).toString());
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new Error("Only default ports are allowed");
  }
  if (u.username || u.password) throw new Error("Credentials in URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) throw new Error("IP-literal hosts are not allowed");
  return u;
}

function getOnce(
  url: URL,
  maxBytes: number,
  deadline: number,
  headers: Record<string, string> = {},
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error("Timed out"));
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      { headers, lookup: publicOnlyLookup, timeout: remaining },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks, Math.min(total, maxBytes)),
            truncated,
          });
        };
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= maxBytes) {
            truncated = total > maxBytes;
            res.destroy();
            finish();
          }
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", (err) => {
          if (!done) reject(err);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
  });
}

/** dns.lookup that refuses to hand back non-public addresses. */
const publicOnlyLookup = ((
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(
        Object.assign(new Error(`Blocked non-public address for ${hostname}`), {
          code: "EBLOCKED",
        }),
        "",
        4,
      );
    }
    if (options.all) return callback(null, list);
    const first = list[0];
    if (first) callback(null, first.address, first.family);
  });
}) as unknown as net.LookupFunction;

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPublicV4(ip);
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicV4(mapped[1] ?? "");
    if (lower === "::" || lower === "::1") return false;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    if (lower.startsWith("64:ff9b:")) return false; // NAT64
    if (lower.startsWith("2001:db8:")) return false; // documentation
    return true;
  }
  return false;
}

function isPublicV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast + reserved
  return true;
}
