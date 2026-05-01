/**
 * Deck page — three states wrapped in one screen:
 *
 *   1. INPUT    — topic input + "Generate deck" button
 *   2. PROGRESS — live slide cards + Claude ticker + cancel
 *   3. PREVIEW  — completed deck summary + "Add to design" + reset
 *
 * The page hydrates a job_id from `?job=` if present (resume flow). State
 * transitions are entirely driven by `useDeck` — when the SSE stream emits
 * `deck_assembled` we move from progress to preview automatically.
 */
import { Alert, Button, Rows, Text, Title } from "@canva/app-ui-kit";
import { getDesignMetadata, getDesignToken } from "@canva/design";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SlideCard } from "src/components/slide_card";
import { SourceChip } from "src/components/source_chip";
import { TopicInput } from "src/components/topic_input";
import { useAppContext } from "src/context/use_app_context";
import { useDeck } from "src/hooks/use_deck";
import { Paths } from "src/routes/paths";

const PARALLEL_OFFWHITE = "#F9F8F4";
const PARALLEL_BLACK = "#1D1B16";
const PARALLEL_BRAND = "#FB631B";
const PARALLEL_GREY_300 = "#E5E5E5";
const PARALLEL_GREY_600 = "#858483";
const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

export const DeckPage = () => {
  const navigate = useNavigate();
  const { topicInput } = useAppContext();
  const [params] = useSearchParams();
  const { state, start, attach, cancel, reset, insert } = useDeck();
  const [designId, setDesignId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);

  // Resolve the design id once on mount.
  // We try the JWT payload first (stable across token refreshes), falling
  // back to the design title or a constant. Same logic as home.tsx so
  // history + active lookups use the same key as deck creation.
  useEffect(() => {
    let cancelledLocal = false;
    void (async () => {
      let id: string | null = null;
      try {
        const { token } = await getDesignToken();
        const payloadPart = token.split(".")[1];
        if (payloadPart) {
          const json = atob(
            payloadPart.replace(/-/g, "+").replace(/_/g, "/"),
          );
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
            if (typeof v === "string" && v.length > 0) {
              id = v;
              break;
            }
          }
        }
      } catch {
        /* fall through */
      }
      if (!id) {
        try {
          const meta = await getDesignMetadata();
          id = meta.title ? `title:${meta.title}` : "untitled-design";
        } catch {
          id = "untitled-design";
        }
      }
      if (!cancelledLocal) setDesignId(id);
    })();
    return () => {
      cancelledLocal = true;
    };
  }, []);

  // Resume: if URL has ?job=…, attach to it
  useEffect(() => {
    const j = params.get("job");
    if (j && state.jobId !== j) attach(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Elapsed timer for the progress screen
  useEffect(() => {
    if (state.phase !== "researching") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  const onSubmit = async (topic: string) => {
    if (!designId) return;
    await start({ topic, design_id: designId, mode: "orchestrator" });
  };

  const onSubmitUltra = async (topic: string) => {
    if (!designId) return;
    await start({ topic, design_id: designId, mode: "ultra" });
  };

  return (
    <Rows spacing="2u">
      <BackToHome navigate={navigate} />

      {state.phase === "idle" && (
        <Rows spacing="2u">
          <BrandHero
            kicker="PARALLEL  //  RESEARCH BRIEF"
            title="Generate a research deck"
            sub="Type a topic. Claude orchestrates Parallel research subagents and assembles a fully-cited, on-brand deck. ~2-10 minutes."
          />
          <TopicInput
            label="What's the deck about?"
            placeholder='e.g. "Global EV market outlook 2025"'
            ctaLabel="Create Design"
            onSubmit={onSubmit}
            secondaryCta={{
              label: "Advanced Mode",
              onSubmit: onSubmitUltra,
            }}
          />
          {state.error && <Alert tone="critical" title={state.error} />}
        </Rows>
      )}

      {state.phase === "researching" && (
        <ProgressView
          topic={state.topic}
          mode={state.mode}
          elapsed={elapsed}
          ticker={state.ticker}
          cards={state.cards}
          followUpsFired={state.followUpsFired}
          sources={state.sources}
          onCancel={cancel}
        />
      )}

      {state.phase === "ready" && state.deck && (
        <ReadyView
          deck={state.deck}
          cards={state.cards}
          onInsert={insert}
          onNew={reset}
        />
      )}

      {state.phase === "inserting" && (
        <Rows spacing="1u">
          <BrandHero
            kicker="PARALLEL  //  INSERTING"
            title="Adding deck to design…"
            sub="Each slide is being placed as a new page after your current page."
          />
        </Rows>
      )}

      {state.phase === "inserted" && (
        <Rows spacing="2u">
          {state.error ? (
            <Alert tone="warn" title="Deck added with warnings">
              {state.error}
            </Alert>
          ) : (
            <Alert tone="positive" title="Deck added to your design" />
          )}
          <Button variant="primary" onClick={reset} stretch>
            Generate another
          </Button>
        </Rows>
      )}

      {state.phase === "failed" && (
        <Rows spacing="2u">
          <Alert tone="critical" title={state.error || "Something went wrong"} />
          <Button variant="primary" onClick={reset} stretch>
            Try again
          </Button>
        </Rows>
      )}

      {/* Note: keep topicInput in sync so the input persists across nav. */}
      {void topicInput}
    </Rows>
  );
};

// ===== Sub-components =====

function BackToHome({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div onClick={() => navigate(Paths.HOME)} style={{ cursor: "pointer" }}>
      <Text size="small" tone="tertiary">
        ← Back
      </Text>
    </div>
  );
}

function BrandHero({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub: string;
}) {
  return (
    <Rows spacing="0.5u">
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: PARALLEL_GREY_600,
        }}
      >
        {kicker}
      </span>
      <Title size="medium">{title}</Title>
      <Text size="small" tone="tertiary">
        {sub}
      </Text>
      <div
        style={{
          height: 2,
          width: 32,
          backgroundColor: PARALLEL_BRAND,
          marginTop: 4,
        }}
      />
    </Rows>
  );
}

function ProgressView(props: {
  topic: string;
  mode: "orchestrator" | "ultra";
  elapsed: number;
  ticker: string[];
  cards: ReturnType<typeof useDeck>["state"]["cards"];
  followUpsFired: number;
  sources: { considered: number; read: number; urls: string[] };
  onCancel: () => void;
}) {
  const minutes = Math.floor(props.elapsed / 60);
  const seconds = props.elapsed % 60;
  const isUltra = props.mode === "ultra";
  return (
    <Rows spacing="2u">
      <div
        style={{
          backgroundColor: PARALLEL_OFFWHITE,
          border: `1px solid ${PARALLEL_GREY_300}`,
          borderRadius: 4,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.04em",
              color: PARALLEL_GREY_600,
            }}
          >
            {isUltra
              ? "PARALLEL  //  RESEARCHING DECK (ULTRA2X)"
              : "PARALLEL  //  RESEARCHING DECK"}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: PARALLEL_GREY_600,
            }}
          >
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
        <div
          style={{
            fontSize: 14,
            color: PARALLEL_BLACK,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          {props.topic}
        </div>
        <div
          style={{
            fontSize: 11,
            color: PARALLEL_GREY_600,
            fontFamily: FONT_MONO,
          }}
        >
          {isUltra
            ? `${props.sources.read}/${props.sources.considered} sources read`
            : `${props.cards.length} slides · ${props.cards.filter((c) => c.state === "ready").length} ready · ${props.followUpsFired} follow-ups fired`}
        </div>
      </div>

      {/* Claude prose ticker (or Parallel reasoning messages in ultra8x mode) */}
      {props.ticker.length > 0 && (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: `1px solid ${PARALLEL_GREY_300}`,
            borderLeft: `2px solid ${PARALLEL_BRAND}`,
            padding: "10px 12px",
            borderRadius: 2,
            fontSize: 12,
            color: PARALLEL_GREY_600,
            lineHeight: 1.5,
            fontStyle: "italic",
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {props.ticker[props.ticker.length - 1]}
        </div>
      )}

      {/* Sources strip — shows favicons for URLs Parallel has read so far.
          Visible in both modes; populated in ultra8x via SSE progress_stats,
          and in orchestrator mode via per-slide tool_result citations. */}
      {props.sources.urls.length > 0 && (
        <div
          style={{
            backgroundColor: PARALLEL_OFFWHITE,
            border: `1px solid ${PARALLEL_GREY_300}`,
            borderRadius: 2,
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.04em",
              color: PARALLEL_GREY_600,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Sources read · {props.sources.urls.length}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            {props.sources.urls.slice(0, 18).map((u) => (
              <SourceChip key={u} url={u} />
            ))}
            {props.sources.urls.length > 18 && (
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: PARALLEL_GREY_600,
                  padding: "3px 4px",
                }}
              >
                +{props.sources.urls.length - 18}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Slide cards */}
      <Rows spacing="0.5u">
        {props.cards.length === 0 && (
          <Text size="small" tone="tertiary">
            Picking templates and starting research…
          </Text>
        )}
        {props.cards.map((c, i) => (
          <SlideCard
            key={c.id}
            index={i + 1}
            template_id={c.template_id}
            state={c.state}
            detail={c.detail}
            preview={c.preview}
            citations={c.citations}
            error={c.error}
            note={c.note}
          />
        ))}
      </Rows>

      <Text size="small" tone="tertiary">
        You can close this panel and come back. The deck keeps researching.
      </Text>
      <Button variant="tertiary" onClick={props.onCancel} stretch>
        Cancel deck
      </Button>
    </Rows>
  );
}

function ReadyView(props: {
  deck: NonNullable<ReturnType<typeof useDeck>["state"]["deck"]>;
  cards: ReturnType<typeof useDeck>["state"]["cards"];
  onInsert: () => void;
  onNew: () => void;
}) {
  const totalCitations = new Set(
    props.deck.slides.flatMap((s) => s.citations.map((c) => c.url)),
  ).size;
  return (
    <Rows spacing="2u">
      <BrandHero
        kicker={`DECK READY  //  ${props.deck.slides.length} SLIDES  //  ${totalCitations} SOURCES`}
        title={props.deck.topic}
        sub="Each slide is researched and cited. Add to your design or refine specific slides."
      />

      <Rows spacing="0.5u">
        {props.cards.map((c, i) => (
          <SlideCard
            key={c.id}
            index={i + 1}
            template_id={c.template_id}
            state="ready"
            preview={c.preview}
            citations={c.citations}
            note={c.note}
          />
        ))}
      </Rows>

      <Button variant="primary" onClick={props.onInsert} stretch>
        Add deck to design
      </Button>
      <Button variant="tertiary" onClick={props.onNew} stretch>
        New deck
      </Button>
    </Rows>
  );
}
