/** App name shown in UI. */
export const APP_NAME = "Parallel Facts";

/** Tagline shown under the app name. */
export const APP_TAGLINE = "Web-researched facts, cited sources, zero hallucination.";

/** Expected durations (for progress animations). */
export const PREVIEW_LOADING_SECONDS = 20; // core-fast
export const DEEP_LOADING_SECONDS = 120; // pro
export const PUBLICATION_LOADING_SECONDS = 45; // simulated ultra2x for demo

/** Polling interval for task status. */
export const POLLING_INTERVAL_SECONDS = 2;

/** Default numbers. */
export const DEFAULT_FACT_COUNT = 8;
export const MAX_FACT_COUNT = 10;

/**
 * Set to true to use mock data instead of real backend calls.
 * Useful for dev when the backend isn't running or PARALLEL_API_KEY isn't set.
 *
 * Default: false — prefer real backend.
 * Toggle to `true` for offline demo reliability.
 */
export const USE_MOCK_DATA = false;
