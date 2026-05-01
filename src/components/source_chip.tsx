/**
 * Compact, clickable source chip — favicon + clean domain.
 *
 * Visual: white surface, 1px grey-300 border, 2px corner radius
 * (Parallel tag radius), mono font on the domain text in grey-700.
 * Matches the design system's tag/chip pattern.
 *
 * Favicon source: Google's universal endpoint
 *   https://www.google.com/s2/favicons?domain={hostname}&sz=32
 * Falls back gracefully if image load fails.
 */
import { useMemo, useState } from "react";
import { COLORS } from "src/design/tokens";

const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

type Props = {
  url: string;
  /** Visual size: small (default, in cards) or large (modal). */
  size?: "small" | "large";
};

export function SourceChip({ url, size = "small" }: Props) {
  const host = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }, [url]);
  const [iconBroken, setIconBroken] = useState(false);

  if (!host) return null;

  const isLarge = size === "large";
  const fontSize = isLarge ? 12 : 11;
  const iconSize = isLarge ? 16 : 13;
  const padding = isLarge ? "6px 10px" : "3px 8px";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding,
        borderRadius: 2, // Parallel tag radius
        border: `1px solid ${COLORS.grey300}`,
        backgroundColor: COLORS.white,
        textDecoration: "none",
        maxWidth: isLarge ? 280 : 200,
      }}
    >
      {!iconBroken && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
          alt=""
          width={iconSize}
          height={iconSize}
          style={{ flexShrink: 0, display: "block" }}
          onError={() => setIconBroken(true)}
        />
      )}
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize,
          color: COLORS.grey700,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {host}
      </span>
    </a>
  );
}
