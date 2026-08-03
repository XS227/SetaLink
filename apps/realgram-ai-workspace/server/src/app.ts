import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { GenerationAdapter } from "./adapters/types.js";
import { GenerationJobNotFoundError, GenerationNotImplementedError } from "./adapters/types.js";
import { MockGenerationAdapter } from "./adapters/mockAdapter.js";
import { meetingTitle, participants, scenes, askRealAiPrompt } from "./demo/script.js";
import { answerQuestion, getMeetingSummary, getTranscript } from "./demo/aiMock.js";

/**
 * Express app factory — takes an adapter instance rather than reaching for
 * a global, so tests can inject a fresh MockGenerationAdapter per run
 * instead of sharing state across test cases.
 */
export function createApp(adapter: GenerationAdapter): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, provider: adapter.provider });
  });

  app.get("/api/demo/script", (_req, res) => {
    res.json({ meetingTitle, participants, scenes, askRealAiPrompt, transcript: getTranscript() });
  });

  app.post("/api/ai/ask", (req, res) => {
    const question = typeof req.body?.question === "string" ? req.body.question : "";
    if (!question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    res.json({ answer: answerQuestion(question) });
  });

  app.get("/api/ai/summary", (_req, res) => {
    res.json(getMeetingSummary());
  });

  app.post("/api/generation/image", async (req, res, next) => {
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
      if (!prompt.trim()) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }
      const job = await adapter.generateImage({
        prompt,
        mode: req.body?.mode,
        characterId: req.body?.characterId,
        aspectRatio: req.body?.aspectRatio,
      });
      res.status(202).json(job);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/generation/video", async (req, res, next) => {
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
      if (!prompt.trim()) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }
      const job = await adapter.generateVideo({
        prompt,
        mode: req.body?.mode,
        characterId: req.body?.characterId,
        sourceImageUrl: req.body?.sourceImageUrl,
        durationSeconds: req.body?.durationSeconds,
      });
      res.status(202).json(job);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/generation/:id", async (req, res, next) => {
    try {
      const job = await adapter.getGenerationStatus(req.params.id);
      res.json(job);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/characters", async (_req, res, next) => {
    try {
      res.json(await adapter.listCharacters());
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/characters", async (req, res, next) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      if (!name.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const character = await adapter.createCharacter({
        name,
        referenceImageUrls: Array.isArray(req.body?.referenceImageUrls)
          ? req.body.referenceImageUrls
          : [],
      });
      res.status(201).json(character);
    } catch (err) {
      next(err);
    }
  });

  /**
   * "Delete session data" control from the AI panel's privacy row. Nothing
   * in this prototype is persisted to disk/DB — this clears the in-memory
   * generation jobs held for the mock adapter (the only adapter that keeps
   * anything server-side); the browser separately clears its own local
   * state. See docs/higgsfield-contest-submission.md, "Privacy and consent".
   */
  app.delete("/api/session", (_req, res) => {
    if (adapter instanceof MockGenerationAdapter) {
      adapter.reset();
    }
    res.status(204).end();
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GenerationJobNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof GenerationNotImplementedError) {
      res.status(501).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
