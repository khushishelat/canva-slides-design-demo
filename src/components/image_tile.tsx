/**
 * One image result in the sidebar grid: an App UI Kit `ImageCard` with a
 * provenance badge, plus the source domain and pixel size underneath.
 * Click to insert onto the current slide.
 *
 * Thumbnails load straight from the publisher; tiles whose thumbnail fails
 * to load (hotlink protection, dead link) hide themselves.
 */
import { ImageCard } from "@canva/app-ui-kit";
import { useState } from "react";
import { COLORS } from "src/design/tokens";
import type { ImageCandidate } from "src/types";

const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

type Props = {
  image: ImageCandidate;
  status: "idle" | "inserting" | "inserted" | "error";
  onInsert: () => void;
};

export function ImageTile({ image, status, onInsert }: Props) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  const done = status === "inserted";
  const label = done
    ? "✓ INSERTED"
    : image.provenance === "official"
      ? "OFFICIAL SOURCE"
      : image.provenance === "commons"
        ? "WIKIMEDIA"
        : null;

  return (
    <div style={{ minWidth: 0 }}>
      <ImageCard
        thumbnailUrl={image.image_url}
        alt={image.title || image.source_host || ""}
        ariaLabel={`Insert image from ${image.source_host ?? "the web"}`}
        thumbnailAspectRatio={4 / 3}
        borderRadius="standard"
        loading={status === "inserting"}
        onClick={onInsert}
        onImageLoad={(s) => s === "error" && setBroken(true)}
        bottomEnd={
          label ? (
            <TileBadge
              text={label}
              accent={done || image.provenance === "official"}
            />
          ) : undefined
        }
        bottomEndVisibility="always"
      />
      <div style={{ padding: "4px 2px 0" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: COLORS.grey700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {image.source_host}
        </div>
        <div
          style={{ fontFamily: FONT_MONO, fontSize: 9, color: COLORS.grey500 }}
        >
          {image.width}×{image.height}
        </div>
      </div>
    </div>
  );
}

function TileBadge({ text, accent }: { text: string; accent: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 2,
        backgroundColor: COLORS.black,
        color: COLORS.white,
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          backgroundColor: accent ? COLORS.brand : COLORS.grey500,
        }}
      />
      {text}
    </span>
  );
}
