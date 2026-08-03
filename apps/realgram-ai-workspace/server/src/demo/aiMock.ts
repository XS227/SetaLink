import { askRealAiPrompt, meetingSummary, transcript } from "./script.js";

/**
 * Mocked "Real AI" copilot responses. This is intentionally not a live LLM
 * call — the AI panel is explicit in the UI that meeting analysis is
 * simulated for this prototype (see the consent/privacy copy), so this
 * stays honest with what's actually running.
 *
 * The one exception is generation (image/video), which goes through the
 * real GenerationAdapter abstraction and can be backed by the real
 * Higgsfield API once authenticated.
 */
export function answerQuestion(question: string): string {
  const q = question.trim().toLowerCase();

  if (q.includes("launch visual") || q === askRealAiPrompt.toLowerCase()) {
    return "On it — generating a launch visual using the RealGram brand system now. Watch the AI panel for progress.";
  }
  if (q.includes("summary") || q.includes("decisions") || q.includes("action item")) {
    return "Here's the meeting intelligence pulled from the transcript so far: a summary, three decisions, and three action items.";
  }
  if (q.includes("translate") || q.includes("norwegian") || q.includes("persian") || q.includes("farsi")) {
    return "Captions are available in English, Norwegian, and Persian — use the translation selector in the AI panel.";
  }
  if (q.includes("screen") || q.includes("share")) {
    return "I can see the shared screen once sharing is active and all participants have given consent.";
  }

  return "Noted. In this prototype I respond to a few scripted prompts (launch visual, summary, translation, screen) — a production build would route this to a live model.";
}

export function getMeetingSummary() {
  return meetingSummary;
}

export function getTranscript() {
  return transcript;
}
