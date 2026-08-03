import type { AspectRatio, GenerationJobKind } from "./types.js";

const DIMENSIONS: Record<AspectRatio, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 1024, h: 1024 },
};

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 5);
}

/**
 * Renders a clearly-labeled placeholder "generation result" as an inline
 * SVG data URI — no network call, no filesystem write, deterministic.
 *
 * This stands in for a real Higgsfield asset. It is intentionally styled to
 * look like a finished placeholder card (RealGram gold/charcoal chrome, the
 * actual prompt text) rather than a broken-image icon, but always carries a
 * visible "MOCK GENERATION" badge so it can never be mistaken for a real
 * Higgsfield result in a screenshot or the contest submission.
 */
export function renderPlaceholderSvgDataUri(opts: {
  prompt: string;
  kind: GenerationJobKind;
  aspectRatio: AspectRatio;
}): string {
  const { w, h } = DIMENSIONS[opts.aspectRatio];
  const lines = wrap(opts.prompt, Math.floor(w / 26));
  const lineHeight = Math.round(h * 0.042);
  const startY = h / 2 - (lines.length * lineHeight) / 2;

  const textNodes = lines
    .map(
      (line, i) =>
        `<text x="${w / 2}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${Math.round(h * 0.032)}" fill="#F0F6FF" opacity="0.92">${escapeXml(line)}</text>`,
    )
    .join("");

  const badge = opts.kind === "video" ? "MOCK GENERATION — VIDEO" : "MOCK GENERATION — IMAGE";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070D18"/>
      <stop offset="100%" stop-color="#0D1828"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFF3C4"/>
      <stop offset="100%" stop-color="#FFB627"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="20" fill="none" stroke="#FFB627" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="18" y="18" width="${Math.round((w - 36) * 0.34)}" height="${Math.round(h * 0.052)}" rx="10" fill="url(#gold)"/>
  <text x="${18 + Math.round((w - 36) * 0.34) / 2}" y="${18 + Math.round(h * 0.052) * 0.68}" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="${Math.round(h * 0.022)}" fill="#030609">${badge}</text>
  ${textNodes}
  <text x="${w / 2}" y="${h - 36}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${Math.round(h * 0.02)}" fill="#7A9BC0">RealGram AI Workspace • stand-in asset, not a real Higgsfield render</text>
</svg>`;

  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
