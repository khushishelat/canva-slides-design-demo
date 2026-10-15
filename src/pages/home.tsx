/**
 * Home page — Parallel-branded hero + topic input + resume banner +
 * Previous decks list.
 *
 * On mount:
 *   - Queries /api/deck/active for an in-progress / recent job (resume banner)
 *   - Queries /api/deck/list for all past decks of this design (history list)
 *
 * Both lookups are scoped by design_id (currently the design title; we'll
 * swap for a stable Canva design id once that's surfaced by the SDK).
 */
import { Button, Rows, Text, Title } from "@canva/app-ui-kit";
import { getDesignMetadata, getDesignToken } from "@canva/design";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getActiveDeck,
  listDecks,
  type DeckActiveResponse,
} from "src/api/api";
import { Paths } from "src/routes/paths";

/**
 * Resolve a stable design id by decoding the design's JWT.
 * The JWT payload contains the underlying design id, which stays the
 * same across token refreshes (only the JWT expiry changes). We try
 * common field names; whatever we find first becomes the key. If the
 * JWT is unparseable for any reason, fall back to the design title or
 * a constant.
 */
async function getStableDesignId(): Promise<string> {
  try {
    const { token } = await getDesignToken();
    const parts = token.split(".");
    const payloadPart = parts[1];
    if (payloadPart) {
      // base64-url-decode → JSON
      const json = atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(json) as Record<string, unknown>;
      for (const key of [
        "designId",
        "design_id",
        "did",
        "d_id",
        "design",
        "sub",
      ]) {
        const v = payload[key];
        if (typeof v === "string" && v.length > 0) return v;
      }
    }
  } catch {
    /* ignore */
  }
  // Last-ditch: design title (still better than time-based — at least
  // shared across reloads of a same-titled untitled design)
  try {
    const meta = await getDesignMetadata();
    if (meta.title) return `title:${meta.title}`;
  } catch {
    /* ignore */
  }
  return "untitled-design";
}

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

export const HomePage = () => {
  const navigate = useNavigate();
  const [resume, setResume] = useState<DeckActiveResponse | null>(null);
  const [history, setHistory] = useState<DeckActiveResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const designId = await getStableDesignId();
        if (cancelled) return;
        const [active, list] = await Promise.all([
          getActiveDeck(designId).catch(() => null),
          listDecks(designId).catch(() => [] as DeckActiveResponse[]),
        ]);
        if (cancelled) return;
        setResume(active);
        // Filter the list to exclude the resume job (it's already shown
        // up top via the banner), keep only completed/failed history.
        setHistory(
          list.filter((j) => !active || j.job_id !== active.job_id),
        );
      } catch {
        /* ignore — no banners on error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Rows spacing="3u">
      {/* Resume banner — only when there's an active or just-finished job */}
      {resume && (
        <ResumeBanner
          job={resume}
          onClick={() => navigate(`${Paths.DECK}?job=${resume.job_id}`)}
        />
      )}

      {/* Hero card — primary action */}
      <div
        style={{
          backgroundColor: PARALLEL_OFFWHITE,
          border: `1px solid ${PARALLEL_GREY_300}`,
          borderRadius: 4,
          padding: 20,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: PARALLEL_GREY_600,
            marginBottom: 12,
          }}
        >
          PARALLEL  //  RESEARCH BRIEF
        </div>
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.25,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          Generate a research deck.
        </div>
        <div
          style={{
            fontSize: 13,
            color: PARALLEL_GREY_600,
            marginBottom: 16,
            lineHeight: 1.45,
          }}
        >
          Type a topic. Claude orchestrates Parallel research subagents and
          assembles a fully-cited, on-brand mini deck. Comes back in 2–10
          minutes — close the panel and the deck keeps researching.
        </div>
        <div
          style={{
            height: 2,
            width: 32,
            backgroundColor: PARALLEL_BRAND,
            marginBottom: 16,
          }}
        />
        <Button
          variant="primary"
          onClick={() => navigate(Paths.DECK)}
          stretch
        >
          Start a deck
        </Button>
      </div>

      {/* Secondary CTA — real images of what the slide names */}
      <div
        onClick={() => navigate(Paths.IMAGES)}
        style={{
          cursor: "pointer",
          backgroundColor: "#FFFFFF",
          border: `1px solid ${PARALLEL_GREY_300}`,
          borderLeft: `2px solid ${PARALLEL_BRAND}`,
          borderRadius: 4,
          padding: 16,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: PARALLEL_GREY_600,
            marginBottom: 8,
          }}
        >
          PARALLEL  //  REAL IMAGES
        </div>
        <div
          style={{
            fontSize: 16,
            lineHeight: 1.3,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Put the real thing on your slide.
        </div>
        <div
          style={{
            fontSize: 12,
            color: PARALLEL_GREY_600,
            lineHeight: 1.45,
          }}
        >
          Reads your slide and finds images of the actual facilities, people,
          and products it names — official sources first, credited. ~10
          seconds.
        </div>
      </div>

      {/* Secondary CTA — single fact insert */}
      <div
        onClick={() => navigate(Paths.FACTS)}
        style={{
          cursor: "pointer",
          backgroundColor: "#FFFFFF",
          border: `1px solid ${PARALLEL_GREY_300}`,
          borderRadius: 4,
          padding: 16,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: PARALLEL_GREY_600,
            marginBottom: 8,
          }}
        >
          PARALLEL  //  CITED FACTS
        </div>
        <div
          style={{
            fontSize: 16,
            lineHeight: 1.3,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Just need one cited stat?
        </div>
        <div
          style={{
            fontSize: 12,
            color: PARALLEL_GREY_600,
            lineHeight: 1.45,
          }}
        >
          Type a topic, get 5–10 cited facts, drop any of them onto your
          current slide. ~30 seconds.
        </div>
      </div>

      {/* Previous decks history */}
      {history.length > 0 && <HistoryList items={history} navigate={navigate} />}

      <Title size="xsmall">{/* spacer */}</Title>
    </Rows>
  );
};

function ResumeBanner({
  job,
  onClick,
}: {
  job: DeckActiveResponse;
  onClick: () => void;
}) {
  const isResearching = job.status === "researching";
  const elapsed = Math.floor((Date.now() - job.created_at) / 60000);
  return (
    <div
      onClick={onClick}
      style={{
        cursor: "pointer",
        backgroundColor: "#FFFFFF",
        border: `1px solid ${PARALLEL_GREY_300}`,
        borderLeft: `2px solid ${PARALLEL_BRAND}`,
        borderRadius: 2,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: PARALLEL_BRAND,
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {isResearching ? "▶ RESUME IN-PROGRESS DECK" : "↩ OPEN RECENT DECK"}
      </div>
      <div
        style={{
          fontSize: 13,
          color: PARALLEL_BLACK,
          fontWeight: 500,
          marginBottom: 2,
          lineHeight: 1.3,
        }}
      >
        {truncate(job.topic, 60)}
      </div>
      <div
        style={{
          fontSize: 11,
          color: PARALLEL_GREY_600,
        }}
      >
        {isResearching
          ? `Researching · started ${elapsed} min ago${
              job.slide_count ? ` · ${job.slide_count} slides so far` : ""
            }`
          : `${job.status} · ${elapsed} min ago`}
      </div>
    </div>
  );
}

function HistoryList({
  items,
  navigate,
}: {
  items: DeckActiveResponse[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <Rows spacing="1u">
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: PARALLEL_GREY_600,
          marginBottom: 4,
        }}
      >
        PREVIOUS DECKS  ·  {items.length}
      </div>
      <Rows spacing="0.5u">
        {items.slice(0, 12).map((job) => (
          <HistoryRow
            key={job.job_id}
            job={job}
            onClick={() => navigate(`${Paths.DECK}?job=${job.job_id}`)}
          />
        ))}
      </Rows>
      {items.length > 12 && (
        <Text size="small" tone="tertiary">
          {items.length - 12} more older decks (auto-pruned after 7 days)
        </Text>
      )}
    </Rows>
  );
}

function HistoryRow({
  job,
  onClick,
}: {
  job: DeckActiveResponse;
  onClick: () => void;
}) {
  const dot = STATUS_COLOR[job.status];
  const ago = relativeTime(Date.now() - job.updated_at);
  return (
    <div
      onClick={onClick}
      style={{
        cursor: "pointer",
        backgroundColor: "#FFFFFF",
        border: `1px solid ${PARALLEL_GREY_300}`,
        borderRadius: 2,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: dot,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncate(job.topic, 50)}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: PARALLEL_GREY_500,
            letterSpacing: "0.04em",
            marginTop: 2,
            textTransform: "uppercase",
          }}
        >
          {job.status}
          {job.slide_count != null ? `  ·  ${job.slide_count} slides` : ""}
          {`  ·  ${ago}`}
        </div>
      </div>
      <span style={{ color: PARALLEL_GREY_500, fontSize: 14 }}>›</span>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ready: PARALLEL_GREEN,
  researching: "#3B82F6",
  failed: PARALLEL_RED,
  cancelled: PARALLEL_GREY_500,
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function relativeTime(deltaMs: number): string {
  const m = Math.floor(deltaMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
