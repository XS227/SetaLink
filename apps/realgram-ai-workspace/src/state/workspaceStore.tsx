import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type {
  DemoParticipant,
  DemoScene,
  GenerationJob,
  TranscriptLine,
  TranslationLang,
} from "../types/api";

export type ScreenShareMode = "off" | "simulated" | "real";
export type AssistantActivity = "idle" | "thinking" | "pointing";

export type FeedEntry =
  | { id: string; kind: "qa"; question: string; answer: string }
  | { id: string; kind: "notice"; text: string }
  | { id: string; kind: "shared-asset"; imageUrl: string; prompt: string };

export interface PresentedAsset {
  url: string;
  prompt: string;
}

/** A point the AI "physically" calls out on the shared screen — see AnnotationLayer. */
export interface AiAnnotation {
  id: string;
  xPercent: number;
  yPercent: number;
  label: string;
  imageUrl?: string;
}

export interface WorkspaceState {
  meetingTitle: string;
  participants: DemoParticipant[];
  scenes: DemoScene[];
  askRealAiPrompt: string;
  scriptLoaded: boolean;

  micOn: boolean;
  cameraOn: boolean;
  screenShare: ScreenShareMode;
  captionsOn: boolean;
  presentedAsset: PresentedAsset | null;

  aiConsent: boolean;
  aiActive: boolean;
  assistantActivity: AssistantActivity;
  activeAnnotation: AiAnnotation | null;

  transcript: TranscriptLine[];
  transcriptRevealCount: number;
  translationLang: TranslationLang;
  feed: FeedEntry[];

  summary: string | null;
  decisions: string[];
  actionItems: string[];

  generationJobs: GenerationJob[];

  sceneIndex: number;
  demoPlaying: boolean;
}

export const initialWorkspaceState: WorkspaceState = {
  meetingTitle: "",
  participants: [],
  scenes: [],
  askRealAiPrompt: "",
  scriptLoaded: false,

  micOn: true,
  cameraOn: true,
  screenShare: "off",
  captionsOn: false,
  presentedAsset: null,

  aiConsent: false,
  aiActive: false,
  assistantActivity: "idle",
  activeAnnotation: null,

  transcript: [],
  transcriptRevealCount: 0,
  translationLang: "en",
  feed: [],

  summary: null,
  decisions: [],
  actionItems: [],

  generationJobs: [],

  sceneIndex: 0,
  demoPlaying: false,
};

type Action =
  | {
      type: "SCRIPT_LOADED";
      meetingTitle: string;
      participants: DemoParticipant[];
      scenes: DemoScene[];
      transcript: TranscriptLine[];
      askRealAiPrompt: string;
    }
  | { type: "TOGGLE_MIC" }
  | { type: "TOGGLE_CAMERA" }
  | { type: "SET_SCREEN_SHARE"; mode: ScreenShareMode }
  | { type: "TOGGLE_CAPTIONS" }
  | { type: "GRANT_AI_CONSENT" }
  | { type: "STOP_AI_ANALYSIS" }
  | { type: "DELETE_SESSION_DATA" }
  | { type: "REVEAL_NEXT_TRANSCRIPT_LINE" }
  | { type: "SET_TRANSLATION_LANG"; lang: TranslationLang }
  | { type: "ADD_ASK"; question: string; answer: string }
  | { type: "ADD_NOTICE"; text: string }
  | { type: "SHARE_ASSET_TO_CHAT"; imageUrl: string; prompt: string }
  | { type: "PRESENT_ASSET"; asset: PresentedAsset }
  | { type: "STOP_PRESENTING" }
  | { type: "ADD_GENERATION_JOB"; job: GenerationJob }
  | { type: "UPDATE_GENERATION_JOB"; job: GenerationJob }
  | { type: "SET_SUMMARY"; summary: string; decisions: string[]; actionItems: string[] }
  | { type: "SET_SCENE_INDEX"; index: number }
  | { type: "SET_DEMO_PLAYING"; playing: boolean }
  | { type: "SET_ASSISTANT_ACTIVITY"; activity: AssistantActivity }
  | { type: "SHOW_ANNOTATION"; annotation: AiAnnotation }
  | { type: "CLEAR_ANNOTATION" };

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "SCRIPT_LOADED":
      return {
        ...state,
        scriptLoaded: true,
        meetingTitle: action.meetingTitle,
        participants: action.participants,
        scenes: action.scenes,
        transcript: action.transcript,
        askRealAiPrompt: action.askRealAiPrompt,
      };
    case "TOGGLE_MIC":
      return { ...state, micOn: !state.micOn };
    case "TOGGLE_CAMERA":
      return { ...state, cameraOn: !state.cameraOn };
    case "SET_SCREEN_SHARE":
      return { ...state, screenShare: action.mode };
    case "TOGGLE_CAPTIONS":
      return { ...state, captionsOn: !state.captionsOn };
    case "GRANT_AI_CONSENT":
      return { ...state, aiConsent: true, aiActive: true };
    case "STOP_AI_ANALYSIS":
      return { ...state, aiActive: false };
    case "DELETE_SESSION_DATA":
      return {
        ...state,
        transcriptRevealCount: 0,
        feed: [],
        summary: null,
        decisions: [],
        actionItems: [],
        generationJobs: [],
        activeAnnotation: null,
        presentedAsset: null,
      };
    case "REVEAL_NEXT_TRANSCRIPT_LINE":
      return {
        ...state,
        transcriptRevealCount: Math.min(state.transcriptRevealCount + 1, state.transcript.length),
      };
    case "SET_TRANSLATION_LANG":
      return { ...state, translationLang: action.lang };
    case "ADD_ASK":
      return {
        ...state,
        feed: [...state.feed, { id: crypto.randomUUID(), kind: "qa", question: action.question, answer: action.answer }],
      };
    case "ADD_NOTICE":
      return {
        ...state,
        feed: [...state.feed, { id: crypto.randomUUID(), kind: "notice", text: action.text }],
      };
    case "SHARE_ASSET_TO_CHAT":
      return {
        ...state,
        feed: [
          ...state.feed,
          { id: crypto.randomUUID(), kind: "shared-asset", imageUrl: action.imageUrl, prompt: action.prompt },
        ],
      };
    case "PRESENT_ASSET":
      return { ...state, presentedAsset: action.asset };
    case "STOP_PRESENTING":
      return { ...state, presentedAsset: null };
    case "ADD_GENERATION_JOB":
      return { ...state, generationJobs: [action.job, ...state.generationJobs] };
    case "UPDATE_GENERATION_JOB":
      return {
        ...state,
        generationJobs: state.generationJobs.map((j) => (j.id === action.job.id ? action.job : j)),
      };
    case "SET_SUMMARY":
      return { ...state, summary: action.summary, decisions: action.decisions, actionItems: action.actionItems };
    case "SET_SCENE_INDEX":
      return { ...state, sceneIndex: action.index };
    case "SET_DEMO_PLAYING":
      return { ...state, demoPlaying: action.playing };
    case "SET_ASSISTANT_ACTIVITY":
      return { ...state, assistantActivity: action.activity };
    case "SHOW_ANNOTATION":
      return { ...state, activeAnnotation: action.annotation, assistantActivity: "pointing" };
    case "CLEAR_ANNOTATION":
      return { ...state, activeAnnotation: null };
    default:
      return state;
  }
}

const WorkspaceContext = createContext<{ state: WorkspaceState; dispatch: React.Dispatch<Action> } | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialWorkspaceState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}

/** Narrow convenience hook for components that only need to dispatch known action shapes. */
export function useWorkspaceActions() {
  const { dispatch } = useWorkspace();
  return useMemo(
    () => ({
      toggleMic: () => dispatch({ type: "TOGGLE_MIC" }),
      toggleCamera: () => dispatch({ type: "TOGGLE_CAMERA" }),
      setScreenShare: (mode: ScreenShareMode) => dispatch({ type: "SET_SCREEN_SHARE", mode }),
      toggleCaptions: () => dispatch({ type: "TOGGLE_CAPTIONS" }),
      grantAiConsent: () => dispatch({ type: "GRANT_AI_CONSENT" }),
      stopAiAnalysis: () => dispatch({ type: "STOP_AI_ANALYSIS" }),
      deleteSessionData: () => dispatch({ type: "DELETE_SESSION_DATA" }),
      revealNextTranscriptLine: () => dispatch({ type: "REVEAL_NEXT_TRANSCRIPT_LINE" }),
      setTranslationLang: (lang: TranslationLang) => dispatch({ type: "SET_TRANSLATION_LANG", lang }),
      addAsk: (question: string, answer: string) => dispatch({ type: "ADD_ASK", question, answer }),
      addNotice: (text: string) => dispatch({ type: "ADD_NOTICE", text }),
      shareAssetToChat: (imageUrl: string, prompt: string) => dispatch({ type: "SHARE_ASSET_TO_CHAT", imageUrl, prompt }),
      presentAsset: (asset: PresentedAsset) => dispatch({ type: "PRESENT_ASSET", asset }),
      stopPresenting: () => dispatch({ type: "STOP_PRESENTING" }),
      addGenerationJob: (job: GenerationJob) => dispatch({ type: "ADD_GENERATION_JOB", job }),
      updateGenerationJob: (job: GenerationJob) => dispatch({ type: "UPDATE_GENERATION_JOB", job }),
      setSummary: (summary: string, decisions: string[], actionItems: string[]) =>
        dispatch({ type: "SET_SUMMARY", summary, decisions, actionItems }),
      setSceneIndex: (index: number) => dispatch({ type: "SET_SCENE_INDEX", index }),
      setDemoPlaying: (playing: boolean) => dispatch({ type: "SET_DEMO_PLAYING", playing }),
      setAssistantActivity: (activity: AssistantActivity) => dispatch({ type: "SET_ASSISTANT_ACTIVITY", activity }),
      showAnnotation: (annotation: Omit<AiAnnotation, "id">) =>
        dispatch({ type: "SHOW_ANNOTATION", annotation: { id: crypto.randomUUID(), ...annotation } }),
      clearAnnotation: () => dispatch({ type: "CLEAR_ANNOTATION" }),
      scriptLoaded: (args: {
        meetingTitle: string;
        participants: DemoParticipant[];
        scenes: DemoScene[];
        transcript: TranscriptLine[];
        askRealAiPrompt: string;
      }) => dispatch({ type: "SCRIPT_LOADED", ...args }),
    }),
    [dispatch],
  );
}

