import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { MockGenerationAdapter } from "../adapters/mockAdapter.js";
import { HiggsfieldRestAdapter } from "../adapters/higgsfieldAdapter.js";

describe("realgram-ai-workspace server (mock adapter)", () => {
  it("reports the mock provider on /api/health", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, provider: "mock" });
  });

  it("serves the guided demo script", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app).get("/api/demo/script");
    expect(res.status).toBe(200);
    expect(res.body.meetingTitle).toBe("RealGram Global Product Review");
    expect(res.body.scenes).toHaveLength(9);
    expect(res.body.transcript.length).toBeGreaterThan(0);
  });

  it("rejects an empty prompt", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app).post("/api/generation/image").send({ prompt: "" });
    expect(res.status).toBe(400);
  });

  it("runs a full generation job from queued to completed", async () => {
    const app = createApp(new MockGenerationAdapter());
    const create = await request(app)
      .post("/api/generation/image")
      .send({ prompt: "Launch visual for RealGram AI Workspace", aspectRatio: "16:9" });
    expect(create.status).toBe(202);
    expect(create.body.status).toBe("queued");
    const jobId: string = create.body.id;

    let job = create.body;
    for (let i = 0; i < 20 && job.status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const poll = await request(app).get(`/api/generation/${jobId}`);
      job = poll.body;
    }

    expect(job.status).toBe("completed");
    expect(typeof job.resultUrl).toBe("string");
    expect(job.resultUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  }, 15000);

  it("404s on an unknown generation job id", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app).get("/api/generation/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("answers a scripted Ask Real AI question", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app)
      .post("/api/ai/ask")
      .send({ question: "Create a launch visual for this feature using the RealGram brand." });
    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/launch visual/i);
  });

  it("returns a meeting summary with 3 decisions and 3 action items", async () => {
    const app = createApp(new MockGenerationAdapter());
    const res = await request(app).get("/api/ai/summary");
    expect(res.status).toBe(200);
    expect(res.body.decisions).toHaveLength(3);
    expect(res.body.actionItems).toHaveLength(3);
  });

  it("clears in-memory jobs on DELETE /api/session", async () => {
    const adapter = new MockGenerationAdapter();
    const app = createApp(adapter);
    const create = await request(app).post("/api/generation/image").send({ prompt: "test" });
    await request(app).delete("/api/session");
    const poll = await request(app).get(`/api/generation/${create.body.id}`);
    expect(poll.status).toBe(404);
  });
});

describe("realgram-ai-workspace server (higgsfield adapter, unimplemented paths)", () => {
  it("501s on generateVideo — no verified real endpoint exists yet", async () => {
    const app = createApp(new HiggsfieldRestAdapter("key", "secret"));
    const res = await request(app).post("/api/generation/video").send({ prompt: "test" });
    expect(res.status).toBe(501);
  });

  it("501s on createCharacter — no verified real endpoint exists yet", async () => {
    const app = createApp(new HiggsfieldRestAdapter("key", "secret"));
    const res = await request(app).post("/api/characters").send({ name: "Rostam" });
    expect(res.status).toBe(501);
  });
});
