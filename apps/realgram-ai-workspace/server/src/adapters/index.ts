import type { GenerationAdapter } from "./types.js";
import { MockGenerationAdapter } from "./mockAdapter.js";
import { HiggsfieldRestAdapter } from "./higgsfieldAdapter.js";

/**
 * Single seam for choosing a generation provider. Every route imports
 * `getGenerationAdapter()`, never a concrete class — this is what "keep the
 * generation layer abstract" means structurally.
 *
 * Defaults to the mock adapter unconditionally. Switching to the real
 * Higgsfield adapter requires an explicit opt-in
 * (`GENERATION_ADAPTER=higgsfield` + both API credentials) — this process
 * never initiates Higgsfield OAuth itself and never blocks startup waiting
 * for it. If `GENERATION_ADAPTER=higgsfield` is set without credentials,
 * fail fast with a clear message rather than silently falling back (a
 * silent fallback would make a broken deploy look like a working demo).
 */
let cached: GenerationAdapter | undefined;

export function getGenerationAdapter(): GenerationAdapter {
  if (!cached) {
    cached = createGenerationAdapter();
  }
  return cached;
}

export function createGenerationAdapter(
  env: NodeJS.ProcessEnv = process.env,
): GenerationAdapter {
  const selected = env.GENERATION_ADAPTER ?? "mock";

  if (selected === "mock") {
    return new MockGenerationAdapter();
  }

  if (selected === "higgsfield") {
    const apiKey = env.HIGGSFIELD_API_KEY;
    const apiSecret = env.HIGGSFIELD_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error(
        "GENERATION_ADAPTER=higgsfield requires HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET to be set. " +
          "See .env.example and docs/higgsfield-contest-setup.md.",
      );
    }
    return new HiggsfieldRestAdapter(apiKey, apiSecret);
  }

  throw new Error(
    `Unknown GENERATION_ADAPTER "${selected}" — expected "mock" or "higgsfield".`,
  );
}

export * from "./types.js";
