/**
 * Static content for the guided demo (brief's "Scene 1" .. "Scene 9").
 * Single source of truth, served to the frontend via GET /api/demo/script
 * so scene copy/timing never drifts between the two packages.
 *
 * Everything here is scripted/simulated on purpose — the guided demo must
 * run end-to-end with zero real participants and zero external calls
 * except the generation adapter itself (mock by default). This is the
 * "local, simulated" branch of the privacy disclosure shown in the AI
 * panel; nothing here is sent to a third-party API.
 */

export interface DemoParticipant {
  id: string;
  name: string;
  role: string;
  videoOn: boolean;
  initials: string;
}

export interface DemoScene {
  id: number;
  key: string;
  title: string;
  description: string;
}

export interface TranscriptLine {
  speakerId: string;
  en: string;
  no: string;
  fa: string;
}

export const participants: DemoParticipant[] = [
  { id: "you", name: "You", role: "Host", videoOn: true, initials: "Y" },
  { id: "amina", name: "Amina Farouk", role: "Product Lead", videoOn: true, initials: "AF" },
  { id: "erik", name: "Erik Voss", role: "Engineering", videoOn: false, initials: "EV" },
];

export const meetingTitle = "RealGram Global Product Review";

/**
 * Order matches the product workflow, not the order features were built in:
 * call -> share -> AI analyzes -> AI summarizes -> AI creates -> export.
 * (An earlier pass generated the visual before summarizing; product
 * direction moved summarize earlier so the AI's "understanding" work is
 * visibly done before its "making" work starts.)
 */
export const scenes: DemoScene[] = [
  { id: 1, key: "join", title: "Enter the meeting", description: `You join "${meetingTitle}".` },
  { id: 2, key: "share", title: "Share your screen", description: "Screen sharing goes active for all participants." },
  { id: 3, key: "surface", title: "Real AI analyzes the screen", description: "The AI Workspace product screen appears in the shared view — Real AI notices something worth calling out." },
  { id: 4, key: "summary", title: "Real AI summarizes", description: "Real AI summarizes the discussion so far — decisions, action items, translated captions." },
  { id: 5, key: "ask", title: "Ask Real AI to create", description: "You ask Real AI to create a launch visual for this feature." },
  { id: 6, key: "generate", title: "Generation starts", description: "The generation adapter (Higgsfield when connected, mock otherwise) is called." },
  { id: 7, key: "progress", title: "Generation in progress", description: "Real AI is generating — live queued → processing status." },
  { id: 8, key: "result", title: "Result appears", description: "The finished visual is shown inside the workspace, ready to share back to the meeting." },
  { id: 9, key: "export", title: "Export the pack", description: "The Meeting Intelligence Pack is ready to download." },
];

export const transcript: TranscriptLine[] = [
  {
    speakerId: "amina",
    en: "Let's review the AI Workspace prototype before the Higgsfield contest deadline.",
    no: "La oss gå gjennom AI Workspace-prototypen før fristen for Higgsfield-konkurransen.",
    fa: "بیایید پیش از مهلت مسابقه‌ی Higgsfield، نمونه‌ی اولیه‌ی AI Workspace را بررسی کنیم.",
  },
  {
    speakerId: "you",
    en: "Agreed. The core loop is: share screen, ask Real AI, generate a visual, get a meeting summary.",
    no: "Enig. Kjerneflyten er: del skjerm, spør Real AI, generer et bilde, få et møtesammendrag.",
    fa: "موافقم. جریان اصلی این است: اشتراک صفحه، پرسیدن از Real AI، تولید یک تصویر، دریافت خلاصه‌ی جلسه.",
  },
  {
    speakerId: "erik",
    en: "The generation layer needs to work today even though Higgsfield auth isn't finished yet.",
    no: "Genereringslaget må fungere i dag selv om Higgsfield-autentiseringen ikke er ferdig.",
    fa: "لایه‌ی تولید باید امروز کار کند، حتی اگر احراز هویت Higgsfield هنوز کامل نشده باشد.",
  },
  {
    speakerId: "amina",
    en: "Right — so it should sit behind an adapter we can swap without touching the UI.",
    no: "Riktig — så den bør ligge bak en adapter vi kan bytte uten å røre grensesnittet.",
    fa: "درست است — پس باید پشت یک آداپتور باشد که بدون دست‌زدن به رابط کاربری قابل تعویض است.",
  },
  {
    speakerId: "you",
    en: "Let's ask Real AI to generate a launch visual now, using the RealGram brand.",
    no: "La oss be Real AI om å generere et lanseringsbilde nå, med RealGram-merkevaren.",
    fa: "بیایید همین حالا از Real AI بخواهیم با استفاده از برند RealGram یک تصویر لانچ تولید کند.",
  },
];

export const askRealAiPrompt =
  "Create a launch visual for this feature using the RealGram brand.";

export const meetingSummary = {
  summary:
    "The team reviewed the RealGram AI Workspace prototype ahead of the Higgsfield $100K App Contest deadline. The group agreed the generation layer must work today via a swappable adapter, without waiting on Higgsfield authentication, and confirmed the core demo loop: share screen, ask Real AI, generate a visual, export a meeting summary.",
  decisions: [
    "Ship the contest prototype with a mock generation adapter as the default, not blocked on Higgsfield OAuth.",
    "Keep the generation layer behind a single adapter interface so the real Higgsfield integration is a swap, not a rewrite.",
    "Scope the guided demo to one focused workflow (screen share → AI → generated visual → summary) rather than all of RealGram's features.",
  ],
  actionItems: [
    "Wire the real Higgsfield adapter in once account authentication is completed.",
    "Confirm the generated visual respects RealGram's gold/purple brand system before the submission deadline.",
    "Record the guided demo as the walkthrough video for the Higgsfield Apps listing.",
  ],
};
