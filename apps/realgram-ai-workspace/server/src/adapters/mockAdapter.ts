import { randomUUID } from "node:crypto";
import type {
  Character,
  CreateCharacterParams,
  GenerateImageParams,
  GenerateVideoParams,
  GenerationAdapter,
  GenerationJob,
  GenerationJobKind,
} from "./types.js";
import { GenerationJobNotFoundError } from "./types.js";
import { renderPlaceholderSvgDataUri } from "./placeholderArt.js";

/** How long the mock spends in each stage, tuned for a demo — fast enough
 * to watch live, slow enough that the "progress" UI is visibly real. */
const QUEUED_MS = 900;
const PROCESSING_MS = 2600;

interface InternalJob extends GenerationJob {
  createdAtMs: number;
}

/** Strips the internal `createdAtMs` bookkeeping field before a job crosses the API boundary. */
function toPublic(job: InternalJob): GenerationJob {
  const { createdAtMs: _createdAtMs, ...publicJob } = job;
  return publicJob;
}

/**
 * Default, always-available generation adapter. Fully self-contained (no
 * network calls, no API key) so the guided demo and every automated test
 * run identically with or without Higgsfield credentials — this is what
 * "do not block on Higgsfield OAuth" means in practice.
 *
 * Status is derived from elapsed wall-clock time rather than a setTimeout,
 * so repeated `getGenerationStatus` polls are deterministic and nothing is
 * left running if a job is never polled.
 */
export class MockGenerationAdapter implements GenerationAdapter {
  readonly provider = "mock";

  private jobs = new Map<string, InternalJob>();
  private characters = new Map<string, Character>();

  async generateImage(params: GenerateImageParams): Promise<GenerationJob> {
    return this.createJob("image", params.prompt, params.aspectRatio ?? "16:9");
  }

  async generateVideo(params: GenerateVideoParams): Promise<GenerationJob> {
    return this.createJob("video", params.prompt, "16:9");
  }

  async createCharacter(params: CreateCharacterParams): Promise<Character> {
    const character: Character = {
      id: randomUUID(),
      name: params.name,
      createdAt: new Date().toISOString(),
      referenceImageUrls: params.referenceImageUrls,
    };
    this.characters.set(character.id, character);
    return character;
  }

  async listCharacters(): Promise<Character[]> {
    return [...this.characters.values()];
  }

  async getGenerationStatus(jobId: string): Promise<GenerationJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new GenerationJobNotFoundError(jobId);
    return toPublic(this.materialize(job));
  }

  /** Drops all in-memory jobs/characters — backs the "delete session data" control. */
  reset(): void {
    this.jobs.clear();
    this.characters.clear();
  }

  private createJob(
    kind: GenerationJobKind,
    prompt: string,
    aspectRatio: GenerationJob["aspectRatio"],
  ): GenerationJob {
    const now = new Date();
    const job: InternalJob = {
      id: randomUUID(),
      kind,
      status: "queued",
      prompt,
      provider: this.provider,
      aspectRatio,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdAtMs: now.getTime(),
    };
    this.jobs.set(job.id, job);
    return toPublic(this.materialize(job));
  }

  /** Recompute status/result from elapsed time; store it back so
   * `updatedAt` reflects the last observed transition. */
  private materialize(job: InternalJob): InternalJob {
    const elapsed = Date.now() - job.createdAtMs;

    if (elapsed < QUEUED_MS) {
      return { ...job, status: "queued" };
    }
    if (elapsed < QUEUED_MS + PROCESSING_MS) {
      const next: InternalJob = { ...job, status: "processing", updatedAt: new Date().toISOString() };
      this.jobs.set(job.id, next);
      return next;
    }

    const resultUrl = renderPlaceholderSvgDataUri({
      prompt: job.prompt,
      kind: job.kind,
      aspectRatio: job.aspectRatio ?? "16:9",
    });
    const completed: InternalJob = {
      ...job,
      status: "completed",
      resultUrl,
      thumbnailUrl: resultUrl,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, completed);
    return completed;
  }
}
