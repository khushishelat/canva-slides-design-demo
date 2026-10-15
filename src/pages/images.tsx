/**
 * Image search page.
 *
 * Reads the current slide's text, picks out the real, named things on it
 * (facilities, people, products, logos, charts), runs one Parallel Image
 * Search per subject, and shows results grouped by subject with first-party
 * sources badged. Click any image to drop it onto the slide with its source
 * credited underneath.
 *
 * States: idle (slide text prefilled, editable) → planning → searching
 * (sections fill in as each search lands) → ready.
 */
import {
  Alert,
  Button,
  FormField,
  LoadingIndicator,
  MultilineInput,
  Rows,
  Text,
  Title,
} from "@canva/app-ui-kit";
import { getDesignMetadata } from "@canva/design";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImageTile } from "src/components/image_tile";
import { COLORS } from "src/design/tokens";
import { useImages, type SubjectResult } from "src/hooks/use_images";
import { introspectCurrentPage } from "src/lib/design_introspect";
import { Paths } from "src/routes/paths";
import type { ImageCandidate, VisualSubject } from "src/types";

const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

const KIND_LABEL: Record<VisualSubject["kind"], string> = {
  facility: "FACILITY",
  person: "PERSON",
  product: "PRODUCT",
  logo: "LOGO",
  chart: "CHART",
  place: "PLACE",
  event: "EVENT",
  other: "SUBJECT",
};

export const ImagesPage = () => {
  const navigate = useNavigate();
  const { state, start, insertOne, reset, setInsertStyle } = useImages();
  const [text, setText] = useState("");
  const [fromSlide, setFromSlide] = useState(false);
  const [detectionDone, setDetectionDone] = useState(false);

  // Prefill from the slide: page text first (it names the subjects), then
  // the design title. Also pick up the design's font for the credit line.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [meta, intro] = await Promise.all([
          getDesignMetadata().catch(() => null),
          introspectCurrentPage(),
        ]);
        if (cancelled) return;
        const seed = intro.pageText || meta?.title || "";
        if (seed && !/^untitled/i.test(seed)) {
          setText(seed);
          setFromSlide(!!intro.pageText);
        }
        if (intro.fontRef) setInsertStyle({ fontRef: intro.fontRef });
      } finally {
        if (!cancelled) setDetectionDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setInsertStyle]);

  const totalImages = Object.values(state.results).reduce(
    (n, r) => n + (r.status === "done" ? r.data.images.length : 0),
    0,
  );
  const officialImages = Object.values(state.results).reduce(
    (n, r) =>
      n +
      (r.status === "done"
        ? r.data.images.filter((i) => i.provenance === "official").length
        : 0),
    0,
  );

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
          {detectionDone && fromSlide && (
            <Text size="small" tone="tertiary">
              Text from the current slide.
            </Text>
          )}
          <FormField
            label="Slide text"
            control={(props) => (
              <MultilineInput
                {...props}
                value={text}
                onChange={setText}
                placeholder="Paste or type the slide's text, e.g. “Meta's 5 GW Hyperion campus will run on NVIDIA Vera Rubin racks”"
                minRows={3}
                maxRows={6}
              />
            )}
          />
          <Button
            variant="primary"
            onClick={() => text.trim() && start(text.trim())}
            disabled={text.trim().length < 4}
            stretch
          >
            Find images
          </Button>
        </Rows>
      )}

      {state.phase === "planning" && (
        <Rows spacing="1u">
          <StatusPanel
            kicker="PARALLEL  //  READING SLIDE"
            body={state.text}
            foot="Picking subjects…"
          />
          <LoadingIndicator size="medium" />
        </Rows>
      )}

      {(state.phase === "searching" || state.phase === "ready") && (
        <Rows spacing="2u">
          <SummaryBar
            subjects={state.subjects.length}
            images={totalImages}
            official={officialImages}
            seconds={state.totalSeconds}
            searching={state.phase === "searching"}
          />
          {state.subjects.map((subj, i) => (
            <SubjectSection
              key={subj.id}
              index={i}
              subject={subj}
              result={state.results[subj.id] ?? { status: "loading" }}
              inserts={state.inserts}
              onInsert={(img) => insertOne(img, subj)}
            />
          ))}
          {state.phase === "ready" && (
            <Button variant="tertiary" onClick={reset} stretch>
              New search
            </Button>
          )}
        </Rows>
      )}

      {state.phase === "failed" && (
        <Rows spacing="2u">
          <Alert tone="critical" title={state.error || "Image search failed"} />
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
          color: COLORS.grey600,
        }}
      >
        PARALLEL  //  IMAGE SEARCH
      </span>
      <Title size="medium">Images for this slide</Title>
      <Text size="small" tone="tertiary">
        Searches the web for images of what this slide names. Click one to add
        it.
      </Text>
    </Rows>
  );
}

function StatusPanel({
  kicker,
  body,
  foot,
}: {
  kicker: string;
  body: string;
  foot: string;
}) {
  return (
    <div
      style={{
        backgroundColor: COLORS.offWhite,
        border: `1px solid ${COLORS.grey300}`,
        borderRadius: 4,
        padding: 16,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: COLORS.grey600,
          marginBottom: 8,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          fontSize: 13,
          color: COLORS.black,
          lineHeight: 1.4,
          marginBottom: 6,
        }}
      >
        {body.length > 220 ? body.slice(0, 219) + "…" : body}
      </div>
      <div
        style={{ fontSize: 11, color: COLORS.grey600, fontFamily: FONT_MONO }}
      >
        {foot}
      </div>
    </div>
  );
}

function SummaryBar({
  subjects,
  images,
  official,
  seconds,
  searching,
}: {
  subjects: number;
  images: number;
  official: number;
  seconds: number | null;
  searching: boolean;
}) {
  return (
    <div
      style={{
        backgroundColor: COLORS.offWhite,
        border: `1px solid ${COLORS.grey300}`,
        borderLeft: `2px solid ${COLORS.brand}`,
        borderRadius: 2,
        padding: "10px 12px",
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.04em",
        color: COLORS.grey600,
        lineHeight: 1.6,
      }}
    >
      {subjects} SUBJECTS // {images} IMAGES //{" "}
      <span style={{ color: COLORS.black }}>{official} FROM OFFICIAL SITES</span>
      {searching
        ? "  //  SEARCHING…"
        : seconds != null
          ? `  //  ${seconds.toFixed(1)}s`
          : ""}
    </div>
  );
}

function SubjectSection({
  index,
  subject,
  result,
  inserts,
  onInsert,
}: {
  index: number;
  subject: VisualSubject;
  result: SubjectResult;
  inserts: Record<string, "inserting" | "inserted" | { error: string }>;
  onInsert: (img: ImageCandidate) => void;
}) {
  const insertError = Object.entries(inserts).find(
    ([url, v]) =>
      typeof v === "object" &&
      result.status === "done" &&
      result.data.images.some((i) => i.image_url === url),
  );
  return (
    <Rows spacing="1u">
      <div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.04em",
            color: COLORS.grey600,
            marginBottom: 2,
          }}
        >
          {`0${index + 1}`.slice(-2)} · {KIND_LABEL[subject.kind]}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.black }}>
          {subject.label}
        </div>
        {subject.why && (
          <div
            style={{
              fontSize: 11,
              color: COLORS.grey600,
              marginTop: 2,
              lineHeight: 1.35,
            }}
          >
            “{subject.why}”
          </div>
        )}
      </div>

      {result.status === "loading" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: COLORS.grey600,
          }}
        >
          <LoadingIndicator size="small" />
          Searching…
        </div>
      )}

      {result.status === "error" && (
        <Alert tone="warn" title="Search failed for this subject">
          {result.error}
        </Alert>
      )}

      {result.status === "done" && result.data.images.length === 0 && (
        <Text size="small" tone="tertiary">
          No usable images found.
        </Text>
      )}

      {result.status === "done" && result.data.images.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            {result.data.images.map((img) => {
              const s = inserts[img.image_url];
              return (
                <ImageTile
                  key={img.image_url}
                  image={img}
                  status={
                    s === "inserting" || s === "inserted"
                      ? s
                      : s
                        ? "error"
                        : "idle"
                  }
                  onInsert={() => onInsert(img)}
                />
              );
            })}
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: COLORS.grey500,
            }}
          >
            {result.data.counts.returned} found
            {result.data.counts.stock_dropped > 0
              ? `  ·  ${result.data.counts.stock_dropped} stock dropped`
              : ""}
            {result.data.counts.not_uploadable > 0
              ? `  ·  ${result.data.counts.not_uploadable} unusable`
              : ""}
            {`  ·  ${result.data.elapsed_seconds.toFixed(1)}s`}
          </div>
        </>
      )}

      {insertError && typeof insertError[1] === "object" && (
        <Alert tone="critical" title="Insert failed">
          {insertError[1].error}
        </Alert>
      )}
    </Rows>
  );
}
