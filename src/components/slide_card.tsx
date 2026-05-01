/**
 * One row in the deck progress list. Five visual states:
 *   queued       — greyed, just kicker + template label
 *   researching  — animated pulse + the focus_hint Claude chose
 *   refining     — orange pulse + the verbatim follow-up instruction
 *   ready        — green check, key fact preview, citation favicon row
 *   failed       — red x + error message
 *
 * The card also shows the template label as a mono kicker so the user
 * sees exactly which slide of the deck this is. Rendered as a flex row
 * so growing a card doesn't shift others vertically.
 */
import type { ReactNode } from "react";
import { SourceChip } from "./source_chip";
import type { SlideCitation, TemplateId } from "src/templates/types";

export type SlideCardState =
  | "queued"
  | "researching"
  | "refining"
  | "ready"
  | "failed";

const PARALLEL_OFFWHITE = "#F9F8F4";
const PARALLEL_BLACK = "#1D1B16";
const PARALLEL_BRAND = "#FB631B";
const PARALLEL_GREY_300 = "#E5E5E5";
const PARALLEL_GREY_500 = "#ADADAC";
const PARALLEL_GREY_600 = "#858483";
const PARALLEL_GREEN = "#69BE78";
const PARALLEL_RED = "#E14942";
const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

type Props = {
  index: number; // 1-based
  template_id: TemplateId;
  state: SlideCardState;
  /** Sub-headline shown under the kicker — focus_hint, follow-up text, or content preview. */
  detail?: string;
  /** Once ready: a short preview of the slide's content (title, lead stat). */
  preview?: string;
  /** Once ready: citations to render as favicons. */
  citations?: SlideCitation[];
  /** Optional error message when state === "failed". */
  error?: string;
  /**
   * Optional non-error informational note shown in muted grey. Used for
   * things like "follow-up budget exhausted" — the slide is still ready,
   * we just want to surface that Claude tried and was capped.
   */
  note?: string;
};

export function SlideCard({
  index,
  template_id,
  state,
  detail,
  preview,
  citations,
  error,
  note,
}: Props) {
  const num = String(index).padStart(2, "0");
  const stateMeta = STATE_META[state];
  return (
    <div
      style={{
        backgroundColor: state === "queued" ? "#FAFAFA" : PARALLEL_OFFWHITE,
        border: `1px solid ${PARALLEL_GREY_300}`,
        borderLeft: `2px solid ${stateMeta.accent}`,
        borderRadius: 2,
        padding: "10px 12px",
        opacity: state === "queued" ? 0.6 : 1,
        transition: "opacity 0.3s, border-color 0.3s",
      }}
    >
      {/* Kicker row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: detail || preview || error ? 6 : 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: PARALLEL_GREY_600,
            textTransform: "uppercase",
          }}
        >
          {num}  ·  {template_id}
        </span>
        <StatusBadge state={state} />
      </div>

      {/* Detail text — varies by state */}
      {detail && (
        <div
          style={{
            fontSize: 12,
            color: state === "refining" ? PARALLEL_BRAND : PARALLEL_GREY_600,
            lineHeight: 1.4,
            marginBottom: preview ? 6 : 0,
          }}
        >
          {state === "refining" && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontWeight: 600,
                marginRight: 4,
                fontSize: 11,
              }}
            >
              REFINING:
            </span>
          )}
          {detail}
        </div>
      )}

      {/* Content preview */}
      {preview && state === "ready" && (
        <div
          style={{
            fontSize: 13,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            lineHeight: 1.35,
            marginBottom: citations && citations.length > 0 ? 8 : 0,
          }}
        >
          {preview}
        </div>
      )}

      {/* Citations row (favicons) */}
      {citations && citations.length > 0 && state === "ready" && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 4,
          }}
        >
          {citations.slice(0, 6).map((c) => (
            <SourceChip key={c.url} url={c.url} />
          ))}
          {citations.length > 6 && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: PARALLEL_GREY_500,
                padding: "3px 4px",
              }}
            >
              +{citations.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {state === "failed" && error && (
        <div
          style={{
            fontSize: 12,
            color: PARALLEL_RED,
            marginTop: 4,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      {/* Soft informational note (e.g. follow-up budget reached) */}
      {note && state !== "failed" && (
        <div
          style={{
            fontSize: 11,
            fontFamily: FONT_MONO,
            color: PARALLEL_GREY_500,
            marginTop: 6,
            lineHeight: 1.4,
            fontStyle: "italic",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

const STATE_META: Record<
  SlideCardState,
  { accent: string; label: string; node?: ReactNode }
> = {
  queued: { accent: PARALLEL_GREY_300, label: "QUEUED" },
  researching: { accent: "#3B82F6", label: "RESEARCHING" },
  refining: { accent: PARALLEL_BRAND, label: "REFINING" },
  ready: { accent: PARALLEL_GREEN, label: "READY" },
  failed: { accent: PARALLEL_RED, label: "FAILED" },
};

function StatusBadge({ state }: { state: SlideCardState }) {
  const meta = STATE_META[state];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: meta.accent,
          animation:
            state === "researching" || state === "refining"
              ? "pulse 1.4s ease-in-out infinite"
              : undefined,
        }}
      />
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.06em",
          color: meta.accent,
          fontWeight: 600,
        }}
      >
        {meta.label}
      </span>
    </div>
  );
}
