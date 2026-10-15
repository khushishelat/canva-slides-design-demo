/**
 * Thin Parallel Task API client for the backend.
 * Uses PARALLEL_API_KEY from the environment.
 *
 * Reference:
 *   POST /v1/tasks/runs                    — create
 *   GET  /v1/tasks/runs/{run_id}           — status
 *   GET  /v1/tasks/runs/{run_id}/result    — result (with basis)
 */

const PARALLEL_API_BASE = "https://api.parallel.ai";

export type ProcessorTier =
  | "lite"
  | "base"
  | "core"
  | "core-fast"
  | "pro"
  | "pro-fast"
  | "ultra"
  | "ultra2x"
  | "ultra4x"
  | "ultra8x";

export type OutputSchema =
  | {
      type: "json";
      json_schema: object;
    }
  | {
      /**
       * Free-form text output. Use when you want the model to answer in
       * natural prose / markdown rather than structured fields. Required by
       * the Ultra "deeper findings" pass — deeper insights don't fit a
       * fixed schema, and we parse the markdown afterwards instead.
       */
      type: "text";
      description?: string;
    };

export type TaskSpec = {
  output_schema: OutputSchema;
};

export type CreateTaskBody = {
  input: string;
  processor: ProcessorTier;
  task_spec: TaskSpec;
  enable_events?: boolean;
};

/** Beta header required for SSE event publishing. */
const SSE_BETA_HEADER = "events-sse-2025-07-24";

export type BasisCitation = {
  url: string;
  title: string | null;
  excerpts: string[] | null;
};

export type BasisEntry = {
  field: string;
  reasoning?: string;
  confidence?: "high" | "medium" | "low";
  citations?: BasisCitation[];
};

export type CreateTaskResponse = {
  run_id: string;
  status: string;
};

export type TaskStatusResponse = {
  run_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: { message: string };
};

export type TaskResultResponse<T = unknown> = {
  run_id: string;
  status: string;
  output?: {
    content: T;
    basis?: BasisEntry[];
  };
  basis?: BasisEntry[];
  error?: { message: string };
};

function apiKey(): string {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) {
    throw new Error(
      "PARALLEL_API_KEY is not set. Add it to your .env file.",
    );
  }
  return key;
}

export async function createTask(body: CreateTaskBody): Promise<CreateTaskResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey(),
  };
  // Only send the beta header if events are requested — keeps it scoped to streaming callers.
  if (body.enable_events) {
    headers["parallel-beta"] = SSE_BETA_HEADER;
  }

  const res = await fetch(`${PARALLEL_API_BASE}/v1/tasks/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parallel create task failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Open Parallel's SSE event stream for a task run.
 * Returns the raw `Response` so the caller can pipe `response.body` to a client.
 * Caller is responsible for closing the underlying stream.
 */
export async function openTaskEventStream(
  runId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(
    `${PARALLEL_API_BASE}/v1beta/tasks/runs/${runId}/events`,
    {
      headers: {
        "x-api-key": apiKey(),
        "parallel-beta": SSE_BETA_HEADER,
        Accept: "text/event-stream",
      },
      signal,
    },
  );
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Parallel event stream failed: ${res.status} ${text}`);
  }
  return res;
}

export async function getTaskStatus(runId: string): Promise<TaskStatusResponse> {
  const res = await fetch(`${PARALLEL_API_BASE}/v1/tasks/runs/${runId}`, {
    headers: {
      "x-api-key": apiKey(),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parallel task status failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getTaskResult<T = unknown>(
  runId: string,
): Promise<TaskResultResponse<T>> {
  const res = await fetch(
    `${PARALLEL_API_BASE}/v1/tasks/runs/${runId}/result`,
    {
      headers: {
        "x-api-key": apiKey(),
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parallel task result failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Extracts the `basis` array from either location (top-level or nested in output).
 */
export function extractBasis<T>(result: TaskResultResponse<T>): BasisEntry[] {
  return result.output?.basis || result.basis || [];
}

/**
 * Run a Task to completion: create + poll status until terminal, then fetch
 * result. Used by the Ultra "deeper findings" pass which doesn't need SSE
 * (no UI ticker for it — just appears as a slide when ready).
 *
 * Polls every `pollMs` (default 5s) up to `timeoutMs` (default 15min).
 * Throws on failure or timeout.
 */
export async function runTaskToCompletion<T = unknown>(
  body: CreateTaskBody,
  opts: { pollMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TaskResultResponse<T>> {
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const created = await createTask(body);
  const start = Date.now();
  while (true) {
    if (opts.signal?.aborted) throw new Error("Task aborted");
    const status = await getTaskStatus(created.run_id);
    if (status.status === "completed") {
      return getTaskResult<T>(created.run_id);
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(
        `Parallel task ${status.status}: ${status.error?.message || "(no detail)"}`,
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Parallel task timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ============ Chat API (OpenAI-compatible) ============

export type ChatModel = "speed" | "lite" | "base" | "core";

export type ChatRequestBody = {
  model: ChatModel;
  messages: Array<{ role: "user" | "system"; content: string }>;
  stream?: boolean;
  response_format?: {
    type: "json_schema";
    json_schema: { name: string; schema: object };
  };
  /**
   * Parallel-specific: chain a follow-up to a prior response so the model
   * inherits research context without restating the topic / schema. Pass
   * the `interaction_id` from a previous Chat API response to enable.
   */
  previous_interaction_id?: string;
};

export type ChatResponse = {
  id: string;
  choices: Array<{
    message: { content: string; role: string };
    finish_reason: string | null;
    index: number;
  }>;
  basis?: BasisEntry[];
  created?: number;
  model?: string;
  /** Parallel returns this on every Chat API response. Pass it back via `previous_interaction_id` to continue. */
  interaction_id?: string;
};

/**
 * Make a non-streaming Chat API call with retry-with-backoff for transient
 * connection errors (the v2 prototype hit "Remote end closed connection"
 * mid-flight a few times, and we want to swallow those before they reach
 * the orchestrator). Retries:
 *   - Network/connection errors: 2 retries with 1s, 2s backoff
 *   - 5xx HTTP responses: 2 retries
 *   - 4xx HTTP responses: no retry (caller bug)
 */
export async function chatComplete(
  body: ChatRequestBody,
  opts: { maxRetries?: number } = {},
): Promise<ChatResponse> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      // eslint-disable-next-line no-console
      console.log(
        `[parallel.chat] retry attempt=${attempt} delay=${delayMs}ms last=${
          lastErr instanceof Error ? lastErr.message : String(lastErr)
        }`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const res = await fetch("https://api.parallel.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({ ...body, stream: false }),
      });
      if (res.ok) return res.json();
      const text = await res.text();
      // 4xx errors are caller bugs — don't retry
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Chat API failed: ${res.status} ${text}`);
      }
      lastErr = new Error(`Chat API failed: ${res.status} ${text}`);
    } catch (err) {
      lastErr = err;
      // Throw immediately on caller bugs
      if (err instanceof Error && err.message.startsWith("Chat API failed: 4")) {
        throw err;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ===== Image Search API =====
//
//   POST /v1/images/search  — keyword queries + optional objective → ranked
//   web images (direct image URL, source page URL, title, dimensions).
//
// `advanced` (default) is ~3s at $5/1k requests; `fast` is ~1s at $1/1k but
// does not return width/height, which slide layout needs.

export type ImageSearchMode = "fast" | "advanced";

export type ImageSearchBody = {
  /** 1–5 short keyword queries, each <= 200 chars. */
  search_queries: string[];
  /** What should be in the picture — angle, setting, constraints. */
  objective?: string;
  mode?: ImageSearchMode;
  /** The model that wrote the request and consumes the results. */
  client_model?: string;
  /** Groups related calls made as part of one larger task. */
  session_id?: string;
  advanced_settings?: {
    /** ISO 3166-1 alpha-2 country code. */
    location?: string;
    /** 1–20, default 10. */
    max_results?: number;
  };
};

export type ImageSearchResult = {
  title: string | null;
  image_url: string;
  source_page_url: string | null;
  width: number | null;
  height: number | null;
};

export type ImageSearchResponse = {
  search_id: string;
  session_id: string;
  results: ImageSearchResult[];
};

export async function imageSearch(
  body: ImageSearchBody,
): Promise<ImageSearchResponse> {
  const res = await fetch(`${PARALLEL_API_BASE}/v1/images/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parallel image search failed: ${res.status} ${text}`);
  }
  return res.json();
}
