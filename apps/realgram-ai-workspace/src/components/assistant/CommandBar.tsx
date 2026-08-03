import { useState, type FormEvent } from "react";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { pollGenerationJob } from "../../services/pollGeneration";

function looksLikeGenerationRequest(text: string): boolean {
  const q = text.toLowerCase();
  return ["visual", "image", "generate", "video", "clip", "picture", "graphic"].some((kw) => q.includes(kw));
}

export function CommandBar() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const [question, setQuestion] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !state.aiActive || state.assistantActivity === "thinking") return;

    setQuestion("");
    actions.setAssistantActivity("thinking");
    try {
      const { answer } = await api.askRealAi(trimmed);
      actions.addAsk(trimmed, answer);

      if (looksLikeGenerationRequest(trimmed)) {
        const job = await api.generateImage(trimmed);
        actions.addGenerationJob(job);
        pollGenerationJob(job.id, actions.updateGenerationJob).catch(() => undefined);
      }
    } catch {
      actions.addAsk(trimmed, "Sorry — that request failed. Try again in a moment.");
    } finally {
      actions.setAssistantActivity("idle");
    }
  };

  return (
    <form className="command-bar" onSubmit={handleSubmit}>
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask about what's on screen…"
        disabled={!state.aiActive}
        aria-label="Ask Real AI"
      />
      <button
        type="submit"
        aria-label="Ask"
        disabled={!state.aiActive || state.assistantActivity === "thinking" || !question.trim()}
      >
        <span aria-hidden>↵</span>
      </button>
    </form>
  );
}
