/**
 * Sidebar fact card with an Insert button. The card preview mirrors the
 * inserted element's typography (big orange stat, headline, cited
 * context) so what the user sees in the panel is what lands on the slide.
 *
 * Uses Parallel design tokens directly (COLORS / TYPE) so any future
 * design-system tweak propagates here automatically.
 */
import { Button } from "@canva/app-ui-kit";
import { COLORS } from "src/design/tokens";
import { SourceChip } from "./source_chip";
import type { FactClaim } from "src/types";

const FONT_MONO =
  "ui-monospace, 'SF Mono', 'Fira Code', 'Courier New', monospace";

type Props = {
  claim: FactClaim;
  index: number;
  inserted: boolean;
  onInsert: () => void;
  /** Optional accent color to use for the stat. Falls back to Parallel orange. */
  accent?: string;
};

export function FactCard({ claim, index, inserted, onInsert, accent }: Props) {
  const statColor = accent || COLORS.brand;
  return (
    <div
      style={{
        backgroundColor: COLORS.offWhite,
        border: `1px solid ${COLORS.grey300}`,
        borderLeft: `2px solid ${statColor}`,
        borderRadius: 2, // Parallel tag/small-card radius
        padding: 12,
      }}
    >
      {/* Mono kicker — index + optional category */}
      <div
        style={{
          marginBottom: 8,
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
          color: COLORS.grey600,
          textTransform: "uppercase",
        }}
      >
        {`0${index + 1}`.slice(-2)}
        {claim.category ? `  ·  ${claim.category.toUpperCase()}` : ""}
      </div>

      {/* Big stat — the visual hero (renders in the detected design accent
          color when available, otherwise Parallel signal orange) */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 600,
          color: statColor,
          lineHeight: 1.05,
          marginBottom: 8,
        }}
      >
        {claim.stat}
      </div>

      {/* Headline — what the number means */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.black,
          lineHeight: 1.3,
          marginBottom: 8,
        }}
      >
        {claim.headline}
      </div>

      {/* Context — one sentence with cited source */}
      <div
        style={{
          fontSize: 11,
          color: COLORS.grey700,
          lineHeight: 1.45,
          marginBottom: claim.citations.length > 0 ? 8 : 12,
        }}
      >
        {claim.context}
      </div>

      {/* Source chips — favicons + domains */}
      {claim.citations.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginBottom: 12,
          }}
        >
          {claim.citations.slice(0, 3).map((c) => (
            <SourceChip key={c.url} url={c.url} />
          ))}
          {claim.citations.length > 3 && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: COLORS.grey600,
                padding: "3px 4px",
              }}
            >
              +{claim.citations.length - 3}
            </span>
          )}
        </div>
      )}

      <Button
        variant={inserted ? "tertiary" : "primary"}
        onClick={onInsert}
        disabled={inserted}
        stretch
      >
        {inserted ? "✓ Inserted — drag to position" : "Insert into slide"}
      </Button>
    </div>
  );
}
