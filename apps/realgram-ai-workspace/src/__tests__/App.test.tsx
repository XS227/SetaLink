import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const mockScript = {
  meetingTitle: "RealGram Global Product Review",
  participants: [
    { id: "you", name: "You", role: "Host", videoOn: true, initials: "Y" },
    { id: "amina", name: "Amina Farouk", role: "Product Lead", videoOn: true, initials: "AF" },
  ],
  scenes: [
    { id: 1, key: "join", title: "Enter the meeting", description: "Join." },
    { id: 2, key: "share", title: "Share your screen", description: "Share." },
  ],
  askRealAiPrompt: "Create a launch visual for this feature using the RealGram brand.",
  transcript: [
    { speakerId: "amina", en: "Hello", no: "Hei", fa: "سلام" },
    { speakerId: "you", en: "Hi", no: "Hei der", fa: "سلام به شما" },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("RealGram AI Workspace — main demo flow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/demo/script")) return jsonResponse(mockScript);
        if (url.includes("/api/ai/ask")) return jsonResponse({ answer: "Mock answer." });
        if (url.includes("/api/ai/summary")) {
          return jsonResponse({
            summary: "Mock summary.",
            decisions: ["Decision one", "Decision two", "Decision three"],
            actionItems: ["Action one", "Action two", "Action three"],
          });
        }
        return jsonResponse({}, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the guided demo script and shows the meeting title on the stage", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "RealGram Global Product Review" })).toBeInTheDocument();
  });

  it("renders the top bar's workflow stepper with every phase", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "RealGram Global Product Review" });

    expect(screen.getByRole("list", { name: /meeting workflow/i })).toBeInTheDocument();
    for (const phase of ["Join", "Share", "Analyze", "Summarize", "Create", "Export"]) {
      expect(screen.getByText(phase)).toBeInTheDocument();
    }
  });

  it("gates the assistant behind explicit consent — the orb stays dormant", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "RealGram Global Product Review" });
    expect(screen.getByText(/AI analysis starts only after everyone consents/i)).toBeInTheDocument();
    expect(screen.queryByText(/watching your screen|listening/i)).not.toBeInTheDocument();
  });

  it("wakes Real AI and lets the user ask a question", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "RealGram Global Product Review" });

    await user.click(screen.getByRole("button", { name: /wake real ai/i }));
    expect(await screen.findByText(/^listening$/i)).toBeInTheDocument();

    const input = screen.getByLabelText(/ask real ai/i);
    await user.type(input, "What did we decide?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(await screen.findByText("Mock answer.")).toBeInTheDocument();
  });

  it("can stop AI analysis and delete session data", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "RealGram Global Product Review" });

    await user.click(screen.getByRole("button", { name: /wake real ai/i }));
    await screen.findByText(/^listening$/i);

    await user.click(screen.getByRole("button", { name: /stop ai analysis/i }));
    expect(await screen.findByText(/^paused$/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: /delete session data/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /delete session data/i }));
    expect(screen.getByText(/^paused$/i)).toBeInTheDocument();
  });
});
