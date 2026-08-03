import { useEffect } from "react";
import { WorkspaceProvider, useWorkspace, useWorkspaceActions } from "./state/workspaceStore";
import { useScreenShare } from "./hooks/useScreenShare";
import { api } from "./services/api";
import { TopBar } from "./components/topbar/TopBar";
import { ProjectRail } from "./components/rail/ProjectRail";
import { Stage } from "./components/stage/Stage";
import { LivingAssistant } from "./components/assistant/LivingAssistant";
import { ParticipantDock } from "./components/dock/ParticipantDock";
import "./styles/tokens.css";
import "./styles/app.css";

function WorkspaceShell() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const screenShare = useScreenShare();

  useEffect(() => {
    api.demoScript().then((script) => {
      actions.scriptLoaded({
        meetingTitle: script.meetingTitle,
        participants: script.participants,
        scenes: script.scenes,
        transcript: script.transcript,
        askRealAiPrompt: script.askRealAiPrompt,
      });
    });
    // Runs once on mount — loading the (static, versioned) demo script isn't
    // something later state changes should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screenShare.status === "active" && state.screenShare !== "real") {
      actions.setScreenShare("real");
    }
    if (screenShare.status === "idle" && state.screenShare === "real") {
      actions.setScreenShare("off");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShare.status]);

  const handleShareScreen = async () => {
    await screenShare.start();
  };

  const handleStopShareScreen = () => {
    if (state.screenShare === "real") {
      screenShare.stop();
    }
    actions.setScreenShare("off");
  };

  return (
    <div className="app-shell">
      <TopBar />
      <div className="canvas">
        <ProjectRail />
        <div className="canvas__stage-area">
          <Stage realStream={screenShare.stream} />
          <LivingAssistant />
          <ParticipantDock
            onShareScreen={handleShareScreen}
            onStopShareScreen={handleStopShareScreen}
            shareStatus={screenShare.status}
          />
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
