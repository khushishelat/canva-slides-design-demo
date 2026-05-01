/**
 * Fact-cards hook. Wraps the synchronous /api/facts call + per-card
 * insertion into Canva. State machine:
 *   idle → researching → ready (claims displayed) → user inserts cards
 *   ↓ (on error)
 *   failed
 *
 * The hook also carries an optional `insertStyle` (e.g. detected from
 * the user's design via design_introspect) that's passed through to
 * `insertFact` on each insertion. Callers set this once via
 * `setInsertStyle` after design introspection completes; un-set means
 * default Parallel styling.
 */
import { useCallback, useRef, useState } from "react";
import { generateFacts } from "src/api/api";
import { insertFact, type FactInsertStyle } from "src/lib/fact_inserter";
import type { FactClaim } from "src/types";

type FactsPhase = "idle" | "researching" | "ready" | "failed";

export type FactsState = {
  phase: FactsPhase;
  topic: string;
  claims: FactClaim[];
  insertedIds: Set<string>;
  elapsedSeconds: number | null;
  error: string | null;
  /** Per-claim insert error (claim.id → message). */
  insertErrors: Record<string, string>;
};

export function useFacts(): {
  state: FactsState;
  start: (topic: string) => Promise<void>;
  insertOne: (claim: FactClaim) => Promise<void>;
  reset: () => void;
  /** Apply the design-detected style to all subsequent insertions. */
  setInsertStyle: (style: FactInsertStyle) => void;
} {
  const [state, setState] = useState<FactsState>(makeInitial());
  // Use a ref so updating style doesn't invalidate the insertOne callback.
  const styleRef = useRef<FactInsertStyle>({});

  const reset = useCallback(() => setState(makeInitial()), []);

  const start = useCallback(async (topic: string) => {
    setState({ ...makeInitial(), phase: "researching", topic });
    try {
      const res = await generateFacts(topic);
      setState({
        phase: "ready",
        topic: res.topic,
        claims: res.claims,
        insertedIds: new Set(),
        elapsedSeconds: res.elapsed_seconds,
        error: null,
        insertErrors: {},
      });
    } catch (err: unknown) {
      const e = err as Error & { body?: unknown };
      const errorMsg =
        (e.body && typeof e.body === "object" && "error" in e.body
          ? (e.body as { error: string }).error
          : null) ||
        e.message ||
        "Research failed";
      setState((s) => ({ ...s, phase: "failed", error: errorMsg }));
    }
  }, []);

  const insertOne = useCallback(async (claim: FactClaim) => {
    try {
      await insertFact(claim, styleRef.current);
      setState((s) => {
        const nextErrors = { ...s.insertErrors };
        delete nextErrors[claim.id];
        return {
          ...s,
          insertedIds: new Set([...s.insertedIds, claim.id]),
          insertErrors: nextErrors,
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("Failed to insert fact:", err);
      setState((s) => ({
        ...s,
        insertErrors: { ...s.insertErrors, [claim.id]: msg },
      }));
    }
  }, []);

  const setInsertStyle = useCallback((style: FactInsertStyle) => {
    styleRef.current = style;
  }, []);

  return { state, start, insertOne, reset, setInsertStyle };
}

function makeInitial(): FactsState {
  return {
    phase: "idle",
    topic: "",
    claims: [],
    insertedIds: new Set(),
    elapsedSeconds: null,
    error: null,
    insertErrors: {},
  };
}
