/**
 * Generation adapter contract for RealGram AI Workspace.
 *
 * This is the seam the brief asks for: every route handler talks to
 * `GenerationAdapter`, never to a specific provider. Swapping the mock for
 * the real Higgsfield integration later means changing the value passed to
 * `createGenerationAdapter()` (server/src/adapters/index.ts) — no route or
 * UI code changes.
 */

export type GenerationJobKind = "image" | "video";
export type GenerationStatusValue =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

/**
 * Mirrors the real, verified Higgsfield Soul pipeline's app-path segment
 * (`higgsfield-ai/soul/<mode>`) — reverse-engineered against the live API
 * in the Shahnameh visual-pipeline work. "standard" = no trained identity;
 * "character"/"reference" = generate using a previously created Character.
 */
export type GenerationMode = "standard" | "character" | "reference";

export type AspectRatio = "1:1" | "9:16" | "16:9";

export interface GenerateImageParams {
  prompt: string;
  mode?: GenerationMode;
  characterId?: string;
  aspectRatio?: AspectRatio;
}

export interface GenerateVideoParams {
  prompt: string;
  mode?: GenerationMode;
  characterId?: string;
  sourceImageUrl?: string;
  durationSeconds?: number;
}

export interface CreateCharacterParams {
  name: string;
  referenceImageUrls: string[];
}

export interface Character {
  id: string;
  name: string;
  createdAt: string;
  referenceImageUrls: string[];
}

export interface GenerationJob {
  id: string;
  kind: GenerationJobKind;
  status: GenerationStatusValue;
  prompt: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  resultUrl?: string;
  thumbnailUrl?: string;
  aspectRatio?: AspectRatio;
  error?: string;
  /** Raw provider metadata (e.g. Higgsfield request_id) — for debugging, never rendered as-is. */
  providerMeta?: Record<string, unknown>;
}

/**
 * The abstraction itself. Every method a route needs, nothing a route
 * doesn't. Mirrors the Higgsfield MCP tool surface named in the contest
 * brief (`generate_image`, `generate_video`, `create_character`,
 * `get_generation_status`, `list_characters`) so a future MCP-backed
 * adapter maps 1:1 without reshaping callers.
 */
export interface GenerationAdapter {
  readonly provider: string;
  generateImage(params: GenerateImageParams): Promise<GenerationJob>;
  generateVideo(params: GenerateVideoParams): Promise<GenerationJob>;
  createCharacter(params: CreateCharacterParams): Promise<Character>;
  getGenerationStatus(jobId: string): Promise<GenerationJob>;
  listCharacters(): Promise<Character[]>;
}

export class GenerationNotImplementedError extends Error {
  constructor(provider: string, method: string, note: string) {
    super(
      `${provider} adapter: ${method}() is not implemented — ${note}`,
    );
    this.name = "GenerationNotImplementedError";
  }
}

export class GenerationJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Generation job not found: ${jobId}`);
    this.name = "GenerationJobNotFoundError";
  }
}
