import { api } from "./api";
import type { GenerationJob } from "../types/api";

/**
 * Polls a generation job until it reaches a terminal state, calling
 * `onUpdate` on every observed change. Imperative rather than a hook
 * because it's kicked off from event handlers (Ask Real AI submit, guided
 * demo scene 5) rather than mounted alongside a component's lifecycle.
 */
export async function pollGenerationJob(
  jobId: string,
  onUpdate: (job: GenerationJob) => void,
  { intervalMs = 700, timeoutMs = 30000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<GenerationJob> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await api.generationStatus(jobId);
    onUpdate(job);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Generation job ${jobId} timed out after ${timeoutMs}ms`);
}
