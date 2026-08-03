import type { WorkspaceState } from "../state/workspaceStore";

interface MeetingIntelligencePack {
  meetingTitle: string;
  generatedAt: string;
  participants: { name: string; role: string }[];
  summary: string | null;
  decisions: string[];
  actionItems: string[];
  transcript: { speakerId: string; en: string; no: string; fa: string }[];
  generatedAssets: { prompt: string; kind: string; provider: string; resultUrl?: string }[];
}

/**
 * Builds the "Meeting Intelligence Pack" (Scene 9) and triggers a browser
 * download — entirely client-side (Blob + object URL), nothing round-trips
 * to the server. This is deliberate: the export is built from state already
 * in the browser tab, so "where does this data go" has one honest answer.
 */
export function downloadMeetingIntelligencePack(state: WorkspaceState) {
  const pack: MeetingIntelligencePack = {
    meetingTitle: state.meetingTitle,
    generatedAt: new Date().toISOString(),
    participants: state.participants.map((p) => ({ name: p.name, role: p.role })),
    summary: state.summary,
    decisions: state.decisions,
    actionItems: state.actionItems,
    transcript: state.transcript.slice(0, state.transcriptRevealCount).map((line) => ({
      speakerId: line.speakerId,
      en: line.en,
      no: line.no,
      fa: line.fa,
    })),
    generatedAssets: state.generationJobs
      .filter((j) => j.status === "completed")
      .map((job) => ({ prompt: job.prompt, kind: job.kind, provider: job.provider, resultUrl: job.resultUrl })),
  };

  const baseName = `${slug(state.meetingTitle)}-intelligence-pack`;
  downloadFile(`${baseName}.json`, JSON.stringify(pack, null, 2), "application/json");
  downloadFile(`${baseName}.md`, renderMarkdown(pack), "text/markdown");
}

function renderMarkdown(pack: MeetingIntelligencePack): string {
  const lines: string[] = [
    `# Meeting Intelligence Pack`,
    ``,
    `**Meeting:** ${pack.meetingTitle}`,
    `**Generated:** ${pack.generatedAt}`,
    ``,
    `## Summary`,
    pack.summary ?? "_No summary generated yet._",
    ``,
    `## Decisions`,
    ...(pack.decisions.length ? pack.decisions.map((d) => `- ${d}`) : ["_None recorded._"]),
    ``,
    `## Action items`,
    ...(pack.actionItems.length ? pack.actionItems.map((a) => `- [ ] ${a}`) : ["_None recorded._"]),
    ``,
    `## Generated assets`,
    ...(pack.generatedAssets.length
      ? pack.generatedAssets.map((a) => `- (${a.kind}, ${a.provider}) ${a.prompt}`)
      : ["_None generated yet._"]),
  ];
  return lines.join("\n");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "realgram-meeting";
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
