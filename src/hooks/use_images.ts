/**
 * Real-images hook. State machine:
 *   idle → planning (subjects from slide text) → searching (one Image
 *   Search per subject, in parallel; each section fills in as its search
 *   lands) → ready → user inserts images
 *   ↓ (plan error)
 *   failed
 */
import { selection, type SelectionEvent } from "@canva/design";
import { useCallback, useEffect, useRef, useState } from "react";
import { planImages, searchSubjectImages } from "src/api/api";
import { insertImage, type ImageInsertStyle } from "src/lib/image_inserter";
import type { ImageCandidate, SubjectImages, VisualSubject } from "src/types";

type Phase = "idle" | "planning" | "searching" | "ready" | "failed";

export type SubjectResult =
  | { status: "loading" }
  | { status: "done"; data: SubjectImages }
  | { status: "error"; error: string };

export type ImagesState = {
  phase: Phase;
  text: string;
  subjects: VisualSubject[];
  results: Record<string, SubjectResult>;
  planSeconds: number | null;
  totalSeconds: number | null;
  error: string | null;
  /** image_url → "inserting" | "inserted" | error message */
  inserts: Record<string, "inserting" | "inserted" | { error: string }>;
};

export function useImages() {
  const [state, setState] = useState<ImagesState>(makeInitial());
  const styleRef = useRef<ImageInsertStyle>({});
  // Latest image selection in the editor; a click on a result replaces it.
  const selectionRef = useRef<SelectionEvent<"image"> | undefined>(undefined);
  const [selectedImages, setSelectedImages] = useState(0);

  useEffect(
    () =>
      selection.registerOnChange({
        scope: "image",
        onChange: (event) => {
          selectionRef.current = event;
          setSelectedImages(event.count);
        },
      }),
    [],
  );

  const reset = useCallback(() => setState(makeInitial()), []);

  const start = useCallback(async (text: string) => {
    const t0 = Date.now();
    setState({ ...makeInitial(), phase: "planning", text });
    let plan: Awaited<ReturnType<typeof planImages>>;
    try {
      plan = await planImages(text);
    } catch (err) {
      setState((s) => ({ ...s, phase: "failed", error: errorMessage(err) }));
      return;
    }
    if (plan.subjects.length === 0) {
      setState((s) => ({
        ...s,
        phase: "failed",
        error: "Nothing on this slide is specific enough to search for.",
      }));
      return;
    }

    const loading: Record<string, SubjectResult> = {};
    for (const subj of plan.subjects) loading[subj.id] = { status: "loading" };
    setState((s) => ({
      ...s,
      phase: "searching",
      subjects: plan.subjects,
      results: loading,
      planSeconds: plan.elapsed_seconds,
    }));

    await Promise.all(
      plan.subjects.map(async (subj) => {
        let result: SubjectResult;
        try {
          result = {
            status: "done",
            data: await searchSubjectImages(subj, plan.session_id),
          };
        } catch (err) {
          result = { status: "error", error: errorMessage(err) };
        }
        setState((s) => ({
          ...s,
          results: { ...s.results, [subj.id]: result },
        }));
      }),
    );
    setState((s) => ({
      ...s,
      phase: "ready",
      totalSeconds: (Date.now() - t0) / 1000,
    }));
  }, []);

  const insertOne = useCallback(
    async (candidate: ImageCandidate, subject: VisualSubject) => {
      const key = candidate.image_url;
      setState((s) => ({
        ...s,
        inserts: { ...s.inserts, [key]: "inserting" },
      }));
      try {
        await insertImage(
          candidate,
          subject.label,
          styleRef.current,
          selectionRef.current,
        );
        setState((s) => ({
          ...s,
          inserts: { ...s.inserts, [key]: "inserted" },
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to insert image:", err);
        setState((s) => ({
          ...s,
          inserts: { ...s.inserts, [key]: { error: errorMessage(err) } },
        }));
      }
    },
    [],
  );

  const setInsertStyle = useCallback((style: ImageInsertStyle) => {
    styleRef.current = style;
  }, []);

  return { state, selectedImages, start, insertOne, reset, setInsertStyle };
}

function makeInitial(): ImagesState {
  return {
    phase: "idle",
    text: "",
    subjects: [],
    results: {},
    planSeconds: null,
    totalSeconds: null,
    error: null,
    inserts: {},
  };
}

function errorMessage(err: unknown): string {
  const e = err as Error & { body?: unknown };
  if (e?.body && typeof e.body === "object" && "error" in e.body) {
    return String((e.body as { error: unknown }).error);
  }
  return e?.message || String(err);
}
