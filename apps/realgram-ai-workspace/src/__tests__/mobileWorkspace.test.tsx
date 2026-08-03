import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MOBILE_BREAKPOINT } from "../hooks/useIsMobile";

const mockScript = {
  meetingTitle: "RealGram Global Product Review",
  participants: [
    { id: "you", name: "You", role: "Host", videoOn: true, initials: "Y" },
    { id: "amina", name: "Amina Farouk", role: "Product Lead", videoOn: true, initials: "AF" },
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
  transcript: [{ speakerId: "amina", en: "Hello", no: "Hei", fa: "سلام" }],
};

/** Force useIsMobile's `(max-width: <breakpoint>px)` query to match, so the
 * mobile tree mounts instead of the desktop canvas. */
function mockMobileViewport() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes(`${MOBILE_BREAKPOINT}px`),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
}

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

describe("mobile workspace (viewport <= MOBILE_BREAKPOINT)", () => {
  let statusCalls = 0;

  beforeEach(() => {
    statusCalls = 0;
    mockMobileViewport();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/demo/script")) return ok(mockScript);
        if (url.includes("/api/ai/ask")) return ok({ answer: "Generating a launch visual now." });
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
            summary: "Mock summary.",
            decisions: ["Decision one", "Decision two", "Decision three"],
            actionItems: ["Action one", "Action two", "Action three"],
          });
        }
        return ok({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the mobile tree, not the desktop canvas, below the breakpoint", async () => {
    const { container } = render(<App />);
    await screen.findByText("RealGram Global Product Review");

    expect(container.querySelector(".mobile-workspace")).toBeInTheDocument();
    expect(container.querySelector(".canvas")).not.toBeInTheDocument();
  });

  it("shows meeting name, current step, AI status, primary action, and the generated-visual panel in one view", async () => {
    render(<App />);
    await screen.findByText("RealGram Global Product Review");

    expect(screen.getAllByText("Join").length).toBeGreaterThan(0); // header phase label + stepper
    expect(screen.getByText(/step 1 of 6/i)).toBeInTheDocument();
    expect(screen.getByText(/^paused$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wake real ai/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing generated yet/i)).toBeInTheDocument();
  });

  it("the primary action tracks state: wake AI, then offers to play the guided demo", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("RealGram Global Product Review");

    await user.click(screen.getByRole("button", { name: /wake real ai/i }));
    expect(await screen.findByText(/^listening$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play guided demo/i })).toBeInTheDocument();
  });

  it(
    "runs the guided demo and wires present/share-to-chat on the completed visual",
    async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText("RealGram Global Product Review");

      await user.click(screen.getByRole("button", { name: /wake real ai/i }));
      await user.click(screen.getByRole("button", { name: /play guided demo/i }));

      const image = await screen.findByAltText(mockScript.askRealAiPrompt, {}, { timeout: 10000 });
      expect(image).toHaveAttribute("src", "data:image/svg+xml;base64,AAAA");
      expect(screen.getByText(/demo generation/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /present on stage/i }));
      expect(await screen.findByRole("button", { name: /^presenting$/i })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^share to chat$/i }));
      await user.click(screen.getByRole("button", { name: /open real ai/i }));
      expect(await screen.findByText(/shared to the meeting/i)).toBeInTheDocument();
    },
    20000,
  );

  it("collapses decisions/action items behind closed disclosures with counts, and keeps export secondary", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("RealGram Global Product Review");

    await user.click(screen.getByRole("button", { name: /wake real ai/i }));
    await user.click(screen.getByRole("button", { name: /generate decisions/i }));

    const decisionsToggle = screen.getByRole("button", { name: /^decisions/i });
    expect(decisionsToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(decisionsToggle).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("Decision one")).not.toBeInTheDocument();

    await user.click(decisionsToggle);
    expect(decisionsToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Decision one")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /export meeting intelligence pack/i })).toBeInTheDocument();
  });
});
