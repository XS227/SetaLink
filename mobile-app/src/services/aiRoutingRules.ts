/**
 * AI-provider routing rules — the "clean exit" scaffold.
 *
 * Problem: Claude (Anthropic) and Gemini (Google AI) reject traffic coming
 * from datacenter / known-VPN IP ranges and from sanctioned regions. Our VLESS
 * nodes run on Hetzner, whose IPs those providers block, so the AI apps fail
 * ("not available in your region" / 403 / silent hang) even though general
 * browsing through the same tunnel works fine. This is destination-side
 * blocking of the EXIT IP, not a tunnel fault.
 *
 * Fix: egress AI-provider traffic from a "clean" exit — a non-datacenter or
 * allowlisted node the providers accept. This module is the single source of
 * truth for WHICH hostnames count as AI-provider traffic. xrayConfigBuilder
 * pins them to the dedicated 'ai-out' outbound whenever a clean exit is
 * configured (BuildOptions.aiExit).
 *
 * IMPORTANT — inert by default: with no clean exit configured the rules are
 * NOT applied, so AI traffic keeps flowing through the normal proxy exactly as
 * today (zero behaviour change). The scaffold only activates once infra
 * provisions a clean node and passes it in.
 *
 * Same shape as iranBypassRules: a bundled default list + a version, designed
 * to be remotely updatable via the backend (/v1/routing-rules, higher version)
 * WITHOUT an app release. Rules are admin-curated only — never user-submitted.
 */

export const AI_ROUTING_RULES_VERSION = 1;

export type AiRoutingRuleType = 'domain_suffix' | 'domain';

export interface AiRoutingRule {
  id:       string;
  type:     AiRoutingRuleType;
  value:    string;
  enabled:  boolean;
  note?:    string;
}

export const DEFAULT_AI_ROUTING_RULES: AiRoutingRule[] = [
  // ── Anthropic / Claude ────────────────────────────────────────────────────
  { id: 'anthropic',    type: 'domain_suffix', value: 'anthropic.com',            enabled: true, note: 'Anthropic API + console' },
  { id: 'claude-ai',    type: 'domain_suffix', value: 'claude.ai',                enabled: true, note: 'Claude web app' },
  { id: 'claude-cdn',   type: 'domain_suffix', value: 'claudeusercontent.com',    enabled: true, note: 'Claude artifacts / uploaded content' },

  // ── Google Gemini / AI Studio ─────────────────────────────────────────────
  { id: 'gemini',       type: 'domain_suffix', value: 'gemini.google.com',        enabled: true, note: 'Gemini web app' },
  { id: 'aistudio',     type: 'domain_suffix', value: 'aistudio.google.com',      enabled: true, note: 'Google AI Studio' },
  { id: 'genlang-api',  type: 'domain_suffix', value: 'generativelanguage.googleapis.com', enabled: true, note: 'Gemini API' },
  { id: 'bard-legacy',  type: 'domain_suffix', value: 'bard.google.com',          enabled: true, note: 'legacy Bard host' },

  // ── OpenAI / ChatGPT (same datacenter-block problem — safe to send via the
  //    clean exit so it keeps working under stricter filtering) ──────────────
  { id: 'openai',       type: 'domain_suffix', value: 'openai.com',               enabled: true, note: 'OpenAI API + site' },
  { id: 'chatgpt',      type: 'domain_suffix', value: 'chatgpt.com',              enabled: true, note: 'ChatGPT web app' },
  { id: 'oai-static',   type: 'domain_suffix', value: 'oaistatic.com',            enabled: true, note: 'ChatGPT static assets' },
];

/**
 * Enabled AI-provider rules as Xray routing 'domain'/'full' match strings.
 * `domain_suffix` → 'domain:x' (matches x and every subdomain);
 * `domain`        → 'full:x'   (exact hostname only).
 */
export function getAiRoutingDomains(): string[] {
  const out: string[] = [];
  for (const r of DEFAULT_AI_ROUTING_RULES) {
    if (!r.enabled) continue;
    out.push(r.type === 'domain' ? `full:${r.value}` : `domain:${r.value}`);
  }
  return out;
}
