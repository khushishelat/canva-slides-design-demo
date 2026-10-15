import { user } from "@canva/app-middleware/express";
import cors from "cors";
import express from "express";
import { createBaseServer } from "../utils/backend/base_backend/create";
import { createDeckRouter } from "./routers/deck";
import { createFactsRouter } from "./routers/facts";
import { createImagesRouter } from "./routers/images";

async function main() {
  const APP_ID = process.env.CANVA_APP_ID;

  if (!APP_ID) {
    throw new Error(
      `The CANVA_APP_ID environment variable is undefined. Set it in .env`,
    );
  }

  if (!process.env.PARALLEL_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      "⚠️  PARALLEL_API_KEY is not set. Backend routes will fail. Add it to .env.",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      "⚠️  ANTHROPIC_API_KEY is not set. Deck orchestration will fail. Add it to .env.",
    );
  }

  const router = express.Router();

  router.use(express.json({ limit: "2mb" }));
  router.use(cors());

  // Canva JWT verification — ensures calls come from an authenticated Canva session.
  router.use(user.verifyToken({ appId: APP_ID }));

  // Three flows:
  //   /api/deck   — orchestrated full-deck generation (Claude + Parallel)
  //   /api/facts  — single cited stat insert
  //   /api/images — real images of what's on the slide (Parallel Image Search)
  router.use(createDeckRouter());
  router.use(createFactsRouter());
  router.use(createImagesRouter());

  // eslint-disable-next-line no-console
  console.log("✓ Registered routers: /api/deck · /api/facts · /api/images");

  const server = createBaseServer(router);
  server.start(process.env.CANVA_BACKEND_PORT);
}

main();
