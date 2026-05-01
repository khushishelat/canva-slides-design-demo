/**
 * Facts page — three states (input / researching / ready). The user
 * accepts/edits the auto-detected topic, waits ~30–90s for Parallel
 * Task API `core` to surface 5–10 cited facts, then inserts any of
 * them onto their current slide.
 *
 * Topic detection cascade (idle state, on mount):
 *   1. `getDesignMetadata().title` if it's a real title (not "Untitled")
 *   2. concatenated plaintext from current-page richtext (~400 chars)
 *      via `editContent({contentType:"richtext", target:"current_page"})`
 *   3. fall through to manual entry if both fail
 *
 * Style detection (also on mount, parallel to topic):
 *   - Read every richtext region's color + fontSize × char-count weight
 *   - Pick the most-weighty non-greyscale color → use as the stat's
 *     accent for both the sidebar preview and the inserted element.
 *   - Falls back to Parallel signal orange if the design has no
 *     non-neutral text colors (or permissions denied).
 */
import { Alert, Button, LoadingIndicator, Rows, Text, Title } from "@canva/app-ui-kit";
import { getDesignMetadata } from "@canva/design";
import type { FontRef } from "@canva/design";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FactCard } from "src/components/fact_card";
import { TopicInput } from "src/components/topic_input";
import { useAppContext } from "src/context/use_app_context";
import { useFacts } from "src/hooks/use_facts";
import { introspectCurrentPage } from "src/lib/design_introspect";
import { Paths } from "src/routes/paths";

const COLOR_OFFWHITE = "#F9F8F4";
const COLOR_BLACK = "#1D1B16";
const COLOR_BRAND = "#FB631B";
const COLOR_GREY_300 = "#E5E5E5";
const COLOR_GREY_600 = "#858483";
const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

/**
 * Filter out Canva's generic placeholder titles. Strips trailing
 * dimension info ("Foo - 800px × 600px" → "Foo"); rejects "Untitled"
 * variants and anything under 4 chars.
 */
function cleanTitle(title: string | undefined): string | null {
  if (!title) return null;
  const t = title.trim();
  if (t.length < 4) return null;
  const withoutDims = t
    .replace(/\s*[-–—]\s*\d+\s*px\s*[×x]\s*\d+\s*px\s*$/i, "")
    .replace(/\s*\(\s*Presentation\s*\)\s*$/i, "")
    .trim();
  if (withoutDims.length < 4) return null;
  if (/^untitled/i.test(withoutDims)) return null;
  return withoutDims;
}

export const FactsPage = () => {
  const navigate = useNavigate();
  const { state, start, insertOne, reset, setInsertStyle } = useFacts();
  const { topicInput, setTopicInput } = useAppContext();
  const [detectedTopic, setDetectedTopic] = useState<string | null>(null);
  const [detectedAccent, setDetectedAccent] = useState<string | null>(null);
  const [detectedFont, setDetectedFont] = useState<FontRef | null>(null);
  const [detectionDone, setDetectionDone] = useState(false);

  // Run topic + style detection in parallel on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Both calls are safe to run concurrently — neither writes back.
        const [meta, intro] = await Promise.all([
          getDesignMetadata().catch(() => null),
          introspectCurrentPage(),
        ]);
        if (cancelled) return;

        // Topic: title takes precedence; fall back to page text.
        const titleTopic = cleanTitle(meta?.title);
        const topic = titleTopic || intro.pageText || null;
        if (topic) {
          setDetectedTopic(topic);
          if (!topicInput.trim()) setTopicInput(topic);
        }

        // Style: accent + font from design (either may be null).
        if (intro.accentColor) setDetectedAccent(intro.accentColor);
        if (intro.fontRef) setDetectedFont(intro.fontRef);
        if (intro.accentColor || intro.fontRef) {
          setInsertStyle({
            accent: intro.accentColor || undefined,
            fontRef: intro.fontRef || undefined,
          });
        }
      } catch {
        // Permission denied / SDK error — leave defaults.
      } finally {
        if (!cancelled) setDetectionDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Rows spacing="2u">
      <div onClick={() => navigate(Paths.HOME)} style={{ cursor: "pointer" }}>
        <Text size="small" tone="tertiary">
          ← Back
        </Text>
      </div>

      <Hero />

      {state.phase === "idle" && (
        <Rows spacing="1u">
          <DetectionBanner
            topic={detectedTopic}
            accent={detectedAccent}
            fontDetected={!!detectedFont}
            done={detectionDone}
          />
          <TopicInput
            label={
              detectedTopic
                ? "Topic (edit if needed)"
                : "What topic should the facts cover?"
            }
            placeholder={
              detectedTopic
                ? detectedTopic
                : 'e.g. "Burger industry trends 2024-2025"'
            }
            ctaLabel="Find facts"
            onSubmit={start}
          />
        </Rows>
      )}

      {state.phase === "researching" && (
        <Rows spacing="1u">
          <ResearchingPanel topic={state.topic} />
          <LoadingIndicator size="medium" />
        </Rows>
      )}

      {state.phase === "ready" && (
        <Rows spacing="2u">
          <ReadyHeader
            count={state.claims.length}
            inserted={state.insertedIds.size}
            elapsed={state.elapsedSeconds}
          />
          <Rows spacing="1u">
            {state.claims.map((c, i) => (
              <Rows key={c.id} spacing="0.5u">
                <FactCard
                  index={i}
                  claim={c}
                  inserted={state.insertedIds.has(c.id)}
                  onInsert={() => insertOne(c)}
                  accent={detectedAccent || undefined}
                />
                {state.insertErrors[c.id] && (
                  <Alert tone="critical" title="Insert failed">
                    {state.insertErrors[c.id]}
                  </Alert>
                )}
              </Rows>
            ))}
          </Rows>
          <Button variant="tertiary" onClick={reset} stretch>
            New search
          </Button>
        </Rows>
      )}

      {state.phase === "failed" && (
        <Rows spacing="2u">
          <Alert tone="critical" title={state.error || "Research failed"} />
          <Button variant="primary" onClick={reset} stretch>
            Try again
          </Button>
        </Rows>
      )}
    </Rows>
  );
};

function Hero() {
  return (
    <Rows spacing="0.5u">
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: COLOR_GREY_600,
        }}
      >
        PARALLEL  //  CITED FACTS
      </span>
      <Title size="medium">Find cited facts for your design</Title>
      <Text size="small" tone="tertiary">
        Type a topic. Parallel returns 3–5 cited facts. Click any card to drop
        a stat callout onto your current slide — with the source as a clickable
        link, styled to match your design.
      </Text>
      <div
        style={{
          height: 2,
          width: 32,
          backgroundColor: COLOR_BRAND,
          marginTop: 4,
        }}
      />
    </Rows>
  );
}

/**
 * Status banner above the topic input. Shows what we detected from the
 * design (topic + accent color) so the user understands the prefill
 * and the styling that will be applied to inserts.
 */
function DetectionBanner({
  topic,
  accent,
  fontDetected,
  done,
}: {
  topic: string | null;
  accent: string | null;
  fontDetected: boolean;
  done: boolean;
}) {
  if (!done) {
    return (
      <Text size="small" tone="tertiary">
        Reading topic + style from your design…
      </Text>
    );
  }
  if (!topic && !accent && !fontDetected) {
    return (
      <Text size="small" tone="tertiary">
        No topic or style detected on the current slide. (Tip: switch to a slide
        with text — Canva's app SDK can only read styling from text, not shapes
        or backgrounds.) Type what you want facts
        about below — we'll find 3–5 cited stats and style them with the
        Parallel default.
      </Text>
    );
  }
  // We've detected something useful — topic, accent, or both.
  const accentLabel = accent ? accent.toUpperCase() : null;
  return (
    <div
      style={{
        backgroundColor: COLOR_OFFWHITE,
        border: `1px solid ${COLOR_GREY_300}`,
        borderLeft: `2px solid ${accent || COLOR_BRAND}`,
        borderRadius: 2,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.04em",
          color: COLOR_GREY_600,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        Read from your design
      </div>
      {topic && (
        <div
          style={{
            fontSize: 12,
            color: COLOR_BLACK,
            lineHeight: 1.4,
            marginBottom: accent ? 4 : 0,
          }}
        >
          Topic: <strong>{topic.length > 120 ? topic.slice(0, 119) + "…" : topic}</strong>
        </div>
      )}
      {accent && (
        <div
          style={{
            fontSize: 11,
            color: COLOR_GREY_600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: accent,
              border: `1px solid ${COLOR_GREY_300}`,
            }}
          />
          Stat color matches your design ({accentLabel})
        </div>
      )}
      {fontDetected && (
        <div
          style={{
            fontSize: 11,
            color: COLOR_GREY_600,
            marginTop: accent || topic ? 4 : 0,
          }}
        >
          Font matches your design
        </div>
      )}
    </div>
  );
}

function ResearchingPanel({ topic }: { topic: string }) {
  return (
    <div
      style={{
        backgroundColor: COLOR_OFFWHITE,
        border: `1px solid ${COLOR_GREY_300}`,
        borderRadius: 4,
        padding: 16,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: COLOR_GREY_600,
          marginBottom: 8,
        }}
      >
        PARALLEL  //  RESEARCHING (CHAT API · CORE)
      </div>
      <div
        style={{
          fontSize: 13,
          color: COLOR_BLACK,
          fontWeight: 500,
          marginBottom: 4,
        }}
      >
        {topic}
      </div>
      <div
        style={{
          fontSize: 11,
          color: COLOR_GREY_600,
          fontFamily: FONT_MONO,
        }}
      >
        Searching the web for cited facts · ~30s
      </div>
    </div>
  );
}

function ReadyHeader({
  count,
  inserted,
  elapsed,
}: {
  count: number;
  inserted: number;
  elapsed: number | null;
}) {
  return (
    <div
      style={{
        backgroundColor: COLOR_OFFWHITE,
        border: `1px solid ${COLOR_GREY_300}`,
        borderRadius: 4,
        padding: 12,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: COLOR_GREY_600,
        }}
      >
        FACTS READY  //  {count} CARDS  //  {inserted} INSERTED
        {elapsed != null ? `  //  ${elapsed.toFixed(1)}s` : ""}
      </div>
    </div>
  );
}
