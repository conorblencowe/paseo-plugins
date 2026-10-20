import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { installHeaderStatus } from "./client/header";
import { BuildsPanel } from "./client/panel";
import { BuildkiteSettings } from "./client/settings";
import { StepLogPanel } from "./client/step-log";
import { type SelectedStep, selectStep } from "./client/ui";
import { stepAttachment } from "./shared/buildkite";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "status",
    title: "Buildkite",
    icon: "Workflow",
    context: "workspace",
    locations: ["explorer"],
    Component: (props: PluginWorkspacePanelProps) => (
      <BuildsPanel
        {...props}
        onOpenStep={(step: SelectedStep) => {
          selectStep(props.workspaceId, step);
          client.openPanel("step", { workspaceId: props.workspaceId, location: "workspace" });
        }}
        onOpenSettings={() => client.openSettings("account")}
      />
    ),
  });
  client.addWorkspacePanel({
    id: "step",
    title: "Buildkite log",
    icon: "ScrollText",
    context: "workspace",
    locations: ["workspace"],
    Component: StepLogPanel,
  });
  client.addCommandCenterItem({
    id: "open-status",
    title: "Show Buildkite build status",
    icon: "Workflow",
    keywords: ["buildkite", "ci", "build", "checks"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("status", { location: "explorer" });
    },
  });
  client.addAttachmentSource(stepAttachment);
  client.addSettingsScreen({
    id: "account",
    title: "Buildkite",
    icon: "Workflow",
    Component: BuildkiteSettings,
  });
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Buildkite settings",
    icon: "Settings",
    keywords: ["buildkite", "token", "sign in", "sign out"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("account");
    },
  });
  return installHeaderStatus(client);
}
