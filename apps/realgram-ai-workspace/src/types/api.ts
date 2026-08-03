/** Mirrors server/src/adapters/types.ts + the demo script DTO shape returned by GET /api/demo/script. */

export type GenerationStatusValue = "queued" | "processing" | "completed" | "failed";
export type AspectRatio = "1:1" | "9:16" | "16:9";

export interface GenerationJob {
  id: string;
  kind: "image" | "video";
  status: GenerationStatusValue;
  prompt: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  resultUrl?: string;
  thumbnailUrl?: string;
  aspectRatio?: AspectRatio;
  error?: string;
}

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

export interface DemoScript {
  meetingTitle: string;
  participants: DemoParticipant[];
  scenes: DemoScene[];
  askRealAiPrompt: string;
  transcript: TranscriptLine[];
}

export interface MeetingSummary {
  summary: string;
  decisions: string[];
  actionItems: string[];
}

export type TranslationLang = "en" | "no" | "fa";
