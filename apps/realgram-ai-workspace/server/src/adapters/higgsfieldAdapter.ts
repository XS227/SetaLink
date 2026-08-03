import type {
  Character,
  CreateCharacterParams,
  GenerateImageParams,
  GenerateVideoParams,
  GenerationAdapter,
  GenerationJob,
  GenerationStatusValue,
} from "./types.js";
import { GenerationJobNotFoundError, GenerationNotImplementedError } from "./types.js";

const BASE_URL = "https://platform.higgsfield.ai";

/**
 * Real Higgsfield integration, reverse-engineered against the live API
 * (no official public docs exist) during the Shahnameh visual-pipeline
 * work — see docs/HIGGSFIELD_VISUAL_PIPELINE.md and
 * scripts/higgsfield_generate.py on the shahnameh-backend repo, and the
 * `higgsfield_client` Python SDK source it was verified against:
 *
 *   POST   {BASE_URL}/higgsfield-ai/soul/<mode>   body: { prompt, ... }
 *          -> { request_id, status_url, cancel_url }
 *   GET    <status_url>                            -> { status, ...result }
 *   Auth:  "Authorization: Key <api_key>:<api_secret>"
 *
 * `mode` is a URL path segment ("standard" | "character" | "reference"),
 * not a body field — easy to get wrong, called out explicitly because a
 * past session got this detail wrong before verifying it.
 *
 * Only image generation was ever driven end-to-end against the real API
 * (confirmed reaching Higgsfield's queue, stopped at `not_enough_credits`).
 * Video generation and character/Soul-ID creation were never verified
 * against a real endpoint, so — per the brief's "do not invent tool
 * names" rule, extended here to "do not invent unverified endpoints" —
 * those methods fail loudly with `GenerationNotImplementedError` instead
 * of guessing a request shape.
 */
export class HiggsfieldRestAdapter implements GenerationAdapter {
  readonly provider = "higgsfield";

  private jobMeta = new Map<string, { statusUrl: string; kind: GenerationJob["kind"]; prompt: string; aspectRatio?: GenerationJob["aspectRatio"] }>();

  constructor(private readonly apiKey: string, private readonly apiSecret: string) {
    if (!apiKey || !apiSecret) {
      throw new Error(
        "HiggsfieldRestAdapter requires HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET",
      );
    }
  }

  async generateImage(params: GenerateImageParams): Promise<GenerationJob> {
    const mode = params.mode ?? "standard";
    const body: Record<string, unknown> = { prompt: params.prompt };
    const submitted = await this.submit(`higgsfield-ai/soul/${mode}`, body);

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: submitted.request_id,
      kind: "image",
      status: "queued",
      prompt: params.prompt,
      provider: this.provider,
      aspectRatio: params.aspectRatio,
      createdAt: now,
      updatedAt: now,
      providerMeta: { requestId: submitted.request_id },
    };
    this.jobMeta.set(job.id, {
      statusUrl: submitted.status_url,
      kind: "image",
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
    });
    return job;
  }

  async generateVideo(_params: GenerateVideoParams): Promise<GenerationJob> {
    throw new GenerationNotImplementedError(
      this.provider,
      "generateVideo",
      "no Higgsfield video endpoint has been verified against the real API yet — only higgsfield-ai/soul/<mode> image generation was confirmed end-to-end. Verify the real contract before wiring this up.",
    );
  }

  async createCharacter(_params: CreateCharacterParams): Promise<Character> {
    throw new GenerationNotImplementedError(
      this.provider,
      "createCharacter",
      "Soul ID / character training needs a verified real endpoint (the plan calls for ~20 reference images per character) — not yet reverse-engineered. See docs/HIGGSFIELD_VISUAL_PIPELINE.md.",
    );
  }

  async listCharacters(): Promise<Character[]> {
    throw new GenerationNotImplementedError(
      this.provider,
      "listCharacters",
      "depends on createCharacter's verified endpoint, which does not exist yet.",
    );
  }

  async getGenerationStatus(jobId: string): Promise<GenerationJob> {
    const meta = this.jobMeta.get(jobId);
    if (!meta) throw new GenerationJobNotFoundError(jobId);

    const response = await fetch(meta.statusUrl, {
      headers: { Authorization: `Key ${this.apiKey}:${this.apiSecret}` },
    });
    if (!response.ok) {
      throw new Error(`Higgsfield status check failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as {
      status: string;
      images?: Array<{ url: string }>;
      image_url?: string;
      error?: string;
    };

    const status = mapStatus(data.status);
    const resultUrl = data.images?.[0]?.url ?? data.image_url;
    const now = new Date().toISOString();

    return {
      id: jobId,
      kind: meta.kind,
      status,
      prompt: meta.prompt,
      provider: this.provider,
      aspectRatio: meta.aspectRatio,
      createdAt: now,
      updatedAt: now,
      resultUrl: status === "completed" ? resultUrl : undefined,
      thumbnailUrl: status === "completed" ? resultUrl : undefined,
      error: status === "failed" ? data.error : undefined,
      providerMeta: { requestId: jobId, rawStatus: data.status },
    };
  }

  private async submit(
    application: string,
    body: Record<string, unknown>,
  ): Promise<{ request_id: string; status_url: string; cancel_url: string }> {
    const response = await fetch(`${BASE_URL}/${application}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey}:${this.apiSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Higgsfield submit failed: ${response.status} ${response.statusText} ${text}`);
    }

    return (await response.json()) as {
      request_id: string;
      status_url: string;
      cancel_url: string;
    };
  }
}

function mapStatus(raw: string): GenerationStatusValue {
  switch (raw) {
    case "queued":
      return "queued";
    case "in_progress":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
    case "nsfw":
    case "canceled":
      return "failed";
    default:
      return "processing";
  }
}

