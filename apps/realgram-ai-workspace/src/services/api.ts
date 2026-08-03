import type {
  AspectRatio,
  DemoScript,
  GenerationJob,
  MeetingSummary,
} from "../types/api";

/**
 * Thin fetch client for the demo backend. `/api` is proxied to the local
 * Express server in dev (vite.config.ts); in a split deployment,
 * VITE_API_BASE_URL points at the server directly. The browser never talks
 * to Higgsfield (or any generation provider) directly — everything routes
 * through this server, which is what keeps provider keys out of client code.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  health: () => request<{ ok: boolean; provider: string }>("/api/health"),

  demoScript: () => request<DemoScript>("/api/demo/script"),

  askRealAi: (question: string) =>
    request<{ answer: string }>("/api/ai/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  meetingSummary: () => request<MeetingSummary>("/api/ai/summary"),

  generateImage: (prompt: string, aspectRatio: AspectRatio = "16:9") =>
    request<GenerationJob>("/api/generation/image", {
      method: "POST",
      body: JSON.stringify({ prompt, aspectRatio }),
    }),

  generateVideo: (prompt: string) =>
    request<GenerationJob>("/api/generation/video", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  generationStatus: (id: string) => request<GenerationJob>(`/api/generation/${id}`),

  deleteSession: () => request<void>("/api/session", { method: "DELETE" }),
};
