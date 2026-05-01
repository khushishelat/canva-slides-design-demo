/**
 * Frontend API client for the deck generator.
 *
 * Endpoints:
 *   POST /api/deck                  → { job_id }                 (409 with active_job_id if conflict)
 *   GET  /api/deck/active?design_id → { job_id, status, ... }    (or 404)
 *   GET  /api/deck/:jobId            → snapshot of job state
 *   GET  /api/deck/:jobId/stream     → SSE event stream
 *   POST /api/deck/:jobId/cancel     → cancel a researching job
 */
import { auth } from "@canva/user";

export type CreateDeckResponse = { job_id: string };
export type DeckActiveResponse = {
  job_id: string;
  design_id: string;
  topic: string;
  status: "researching" | "ready" | "failed" | "cancelled";
  created_at: number;
  updated_at: number;
  slide_count?: number;
};
export type DeckSnapshotResponse = DeckActiveResponse & {
  result?: import("src/templates/types").AssembledDeck;
  error?: string;
};
export type DeckConflictResponse = {
  error: string;
  active_job_id: string;
};

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, BACKEND_HOST);
  const token = await auth.getCanvaUserToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Try to surface JSON error body if present
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const err = new Error(`${res.status} ${res.statusText}`) as Error & {
      status?: number;
      body?: unknown;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function createDeck(args: {
  topic: string;
  design_id: string;
  mode?: "orchestrator" | "ultra";
}): Promise<CreateDeckResponse> {
  return authedJson<CreateDeckResponse>("/api/deck", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export async function getActiveDeck(
  design_id: string,
): Promise<DeckActiveResponse | null> {
  try {
    return await authedJson<DeckActiveResponse>(
      `/api/deck/active?design_id=${encodeURIComponent(design_id)}`,
    );
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export type DeckListResponse = { jobs: DeckActiveResponse[] };

/** All decks (any status) for a design, most recent first. */
export async function listDecks(design_id: string): Promise<DeckActiveResponse[]> {
  const res = await authedJson<DeckListResponse>(
    `/api/deck/list?design_id=${encodeURIComponent(design_id)}`,
  );
  return res.jobs;
}

// ===== Facts (single-element insert flow) =====

import type { FactClaim } from "src/types";

export type FactsResponse = {
  topic: string;
  claims: FactClaim[];
  elapsed_seconds: number;
};

export async function generateFacts(topic: string): Promise<FactsResponse> {
  return authedJson<FactsResponse>("/api/facts", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
}

export async function getDeck(jobId: string): Promise<DeckSnapshotResponse> {
  return authedJson<DeckSnapshotResponse>(`/api/deck/${encodeURIComponent(jobId)}`);
}

export async function cancelDeck(jobId: string): Promise<void> {
  await authedJson<{ ok: true }>(
    `/api/deck/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

