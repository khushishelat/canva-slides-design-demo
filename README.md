# Canva Slides Design Demo

A Canva app that turns a topic into a fully-cited, on-brand research deck — and optionally inserts single fact-card callouts onto a user's existing slide.

This is a reference implementation showing how to combine [Anthropic's Claude](https://docs.anthropic.com/) (orchestrator) with [Parallel's Task and Chat APIs](https://docs.parallel.ai/) (research workers) inside a Canva Apps SDK design-editor intent.

## What it does

Two flows, both rendered into the user's Canva design via the Apps SDK:

### 1. Research deck

Generates a 7-12 slide deck on a topic. The deck uses 9 templates (cover, summary, divider, timeline, brief, callout, matrix, quote, appendix) and ships every slide with attached citations from real public sources.

Two generation modes the user can pick:

- **Create Design** (orchestrator mode) — Claude Sonnet orchestrates per-slide research subagents over Parallel Chat API `core`. Phase 1 fans out research + quote-hunt calls in parallel, phase 2 does cross-slide thread-pull follow-ups, phase 3 emits the final deck plan. A separate Parallel `pro-fast` task runs alongside and surfaces a "Deeper Findings" table slide. After the deck assembles, a synthesizer pass lets Claude make 0-3 surgical edits to fold deeper-findings insights into existing slides.

- **Advanced Mode** (ultra mode) — A single Parallel `ultra2x` task call returns long-form markdown research, then Sonnet formats it into the same slide shapes via per-template tool calls. A per-slide refinement pass (one Chat API `core` call per editable slide) tightens depth/sourcing afterward. The `## DEEPER FINDINGS` section of the ultra response is parsed for a markdown table and rendered as a dedicated slide.

Both modes use the same render pipeline (`addPage` with strict element clamping) so the comparison is apples-to-apples.

### 2. Fact cards

A single-shot flow: user types (or has auto-detected from their current slide) a topic, the app hits Parallel Chat API `core`, and returns 3-5 cited stat callouts. The user clicks any card to drop a richtext element onto their current slide. The app reads the design's accent color and font from existing richtext to style the inserted card to match.

## Architecture

```
┌─────────────────┐   SSE stream    ┌──────────────────┐
│  Canva Editor   │ ◄────────────── │  Express backend │
│  (this app's    │                 │   (server.ts)    │
│   sidebar UI)   │ ──── HTTP ────► │                  │
└─────────────────┘                 └────────┬─────────┘
                                             │
                                             ▼
                              ┌─────────────────────────────┐
                              │ orchestrator.ts             │
                              │   ↓                         │
                              │ Anthropic SDK (Sonnet)      │
                              │   ↓ tool_use                │
                              │ orchestrator_tools.ts       │
                              │   - research_slide          │
                              │   - follow_up_slide         │
                              │   - quote_hunt              │
                              │   ↓                         │
                              │ parallel_client.ts          │
                              │   - chatComplete            │
                              │   - createTask / SSE        │
                              └─────────────────────────────┘
```

Key files:

- **Backend**
  - `backend/server.ts` — Express entry, mounts `/api/deck` and `/api/facts` routers.
  - `backend/lib/orchestrator.ts` — Claude orchestration loop for the standard deck path.
  - `backend/lib/ultra_deck.ts` — Single-task ultra2x path with SSE forwarding + Sonnet formatter + per-slide refinement.
  - `backend/lib/synthesizer.ts` — Post-assembly Claude pass that can edit slides via per-template `replace_*` tools.
  - `backend/lib/deeper_findings.ts` — pro-fast text-mode task that produces a deeper-findings table slide alongside the orchestrator.
  - `backend/lib/parallel_client.ts` — Thin Parallel API client (Chat API + Task API + SSE).
  - `backend/templates/*.ts` — Per-template JSON schemas + prompt builders.
- **Frontend**
  - `src/templates/*.ts` — Layout builders that turn assembled slide content into Canva `PageSpec` objects.
  - `src/lib/deck_inserter.ts` — Sequential `addPage` with rate-limit handling and element-bounds clamping.
  - `src/lib/fact_inserter.ts` — Single-richtext element insertion via `addElementAtPoint`.
  - `src/lib/design_introspect.ts` — Read-only design inspection (topic seed + accent color + fontRef).
  - `src/hooks/use_deck.ts` — Deck job state + SSE event consumer.
  - `src/pages/deck.tsx` — Deck flow UI.
  - `src/pages/facts.tsx` — Fact-cards flow UI.

## Requirements

- Node.js `v24`
- npm `v11`

The `.nvmrc` pins Node `v24`; `nvm use` will pick it up.

## Setup

```bash
npm install
cp .env.template .env
```

Fill in your `.env`:

```
CANVA_FRONTEND_PORT=8080
CANVA_BACKEND_PORT=3001
CANVA_BACKEND_HOST=http://localhost:3001
CANVA_APP_ID=                  # from Canva Developer Portal
CANVA_APP_ORIGIN=              # Developer Portal → Settings → Security
CANVA_HMR_ENABLED=TRUE
ANTHROPIC_API_KEY=sk-ant-...   # Anthropic Console
PARALLEL_API_KEY=...           # platform.parallel.ai
```

Get keys:
- Canva App ID + origin: [Canva Developer Portal](https://www.canva.com/developers/apps) (create a new app, pick "Design editor" intent)
- Anthropic API key: [console.anthropic.com](https://console.anthropic.com)
- Parallel API key: [platform.parallel.ai](https://platform.parallel.ai)

## Run

```bash
npm start
```

Then open the [Canva Developer Portal](https://www.canva.com/developers/apps), select your app, and click **Preview**. The app's sidebar opens inside Canva.

## Build

```bash
npm run build
```

The `dist/` output is what you submit to Canva for review.

## Notes

- Deck jobs are persisted on disk under `.deck-jobs/` (gitignored) so a long research run survives backend restarts.
- The deeper-findings slide is purely additive — pro-fast/ultra failures never block deck shipment.
- Per-slide content lengths are schema-capped + defensively truncated in the layout builders to stop overflow into adjacent rows or the footer.
- `deck_inserter.ts` clamps every element's bounds before `addPage` because Canva throws an opaque error if anything extends past the page edge.

## License

MIT — see [LICENSE.md](./LICENSE.md).
