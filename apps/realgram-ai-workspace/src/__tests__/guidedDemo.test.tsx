import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const mockScript = {
  meetingTitle: "RealGram Global Product Review",
  participants: [
    { id: "you", name: "You", role: "Host", videoOn: true, initials: "Y" },
    { id: "amina", name: "Amina Farouk", role: "Product Lead", videoOn: true, initials: "AF" },
    { id: "erik", name: "Erik Voss", role: "Engineering", videoOn: false, initials: "EV" },
  ],
  scenes: [
    { id: 1, key: "join", title: "Enter the meeting", description: "Join." },
    { id: 2, key: "share", title: "Share your screen", description: "Share." },
    { id: 3, key: "surface", title: "Shared product interface", description: "Surface." },
    { id: 4, key: "ask", title: "Ask Real AI", description: "Ask." },
    { id: 5, key: "generate", title: "Generation starts", description: "Generate." },
    { id: 6, key: "progress", title: "Generation in progress", description: "Progress." },
    { id: 7, key: "result", title: "Result appears", description: "Result." },
    { id: 8, key: "summary", title: "Meeting intelligence", description: "Summary." },
    { id: 9, key: "export", title: "Export the pack", description: "Export." },
  ],
  askRealAiPrompt: "Create a launch visual for this feature using the RealGram brand.",
  transcript: [
    { speakerId: "amina", en: "Line 1", no: "Linje 1", fa: "خط ۱" },
    { speakerId: "you", en: "Line 2", no: "Linje 2", fa: "خط ۲" },
    { speakerId: "erik", en: "Line 3", no: "Linje 3", fa: "خط ۳" },
    { speakerId: "amina", en: "Line 4", no: "Linje 4", fa: "خط ۴" },
    { speakerId: "you", en: "Line 5", no: "Linje 5", fa: "خط ۵" },
  ],
};

describe("guided demo (scenes 1-9)", () => {
  let statusCalls = 0;

  beforeEach(() => {
    statusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const ok = (body: unknown) =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

        if (url.includes("/api/demo/script")) return ok(mockScript);
        if (url.includes("/api/ai/ask")) {
          return ok({ answer: "Generating a launch visual using the RealGram brand now." });
        }
        if (url.includes("/api/generation/image")) {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: () =>
              Promise.resolve({
                id: "job-1",
                kind: "image",
                status: "queued",
                prompt: mockScript.askRealAiPrompt,
                provider: "mock",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }),
          } as Response);
        }
        if (url.includes("/api/generation/job-1")) {
          statusCalls += 1;
          const status = statusCalls < 2 ? "processing" : "completed";
          return ok({
            id: "job-1",
            kind: "image",
            status,
            prompt: mockScript.askRealAiPrompt,
            provider: "mock",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            resultUrl: status === "completed" ? "data:image/svg+xml;base64,AAAA" : undefined,
          });
        }
        if (url.includes("/api/ai/summary")) {
          return ok({
            summary: "The team aligned on shipping the mock adapter first.",
            decisions: ["Ship mock adapter default", "Keep generation abstracted", "Scope demo to one workflow"],
            actionItems: ["Wire real Higgsfield later", "Check brand fidelity", "Record demo video"],
          });
        }
        return ok({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "runs end to end: join -> share -> ask -> generate -> result -> summary",
    async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "RealGram Global Product Review" });
      await user.click(screen.getByRole("button", { name: /play guided demo/i }));

      // Scene 2 turns on simulated screen sharing.
      expect(await screen.findByText(/presenting your screen/i, {}, { timeout: 5000 })).toBeInTheDocument();

      // Scene 3: the AI "jumps out" and annotates something on the shared screen
      // (the floating on-stage label and the feed notice both mention it, so
      // assert with findAllByText rather than findByText).
      const annotationMatches = await screen.findAllByText(/team adoption is trending up/i, {}, { timeout: 5000 });
      expect(annotationMatches.length).toBeGreaterThan(0);

      // Scene 4/5 ask Real AI and kick off generation; scene 7 shows the completed asset.
      expect(await screen.findByText("Generating a launch visual using the RealGram brand now.", {}, { timeout: 10000 })).toBeInTheDocument();
      const generatedImage = await screen.findByAltText(mockScript.askRealAiPrompt, {}, { timeout: 10000 });
      expect(generatedImage).toHaveAttribute("src", "data:image/svg+xml;base64,AAAA");

      // Scene 8 produces the meeting summary.
      expect(await screen.findByText(/team aligned on shipping the mock adapter/i, {}, { timeout: 10000 })).toBeInTheDocument();
      expect(screen.getByText("Ship mock adapter default")).toBeInTheDocument();

      // Scene 9 is the terminal scene — export button becomes available.
      expect(await screen.findByRole("button", { name: /export meeting intelligence pack/i })).toBeInTheDocument();
    },
    20000,
  );
});
