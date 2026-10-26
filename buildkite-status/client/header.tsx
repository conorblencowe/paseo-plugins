import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { type ToastVariant, useToast } from "@getpaseo/plugin/client/ui";
import type { PaseoWorkspace } from "@getpaseo/client";
import { useEffect, useSyncExternalStore } from "react";
import { type BuildkiteBuildSummary, statusesRpc } from "../shared/buildkite";
import { expiryWarning } from "../shared/token";
import { isActive, present, stateLabel, StatusIcon, worst } from "./ui";

const IDLE_POLL_MS = 60_000;
const ACTIVE_POLL_MS = 20_000;
const NOTICE_MAX_AGE_MS = 120_000;

const buildsByWorkspace = new Map<string, BuildkiteBuildSummary[]>();
const notices: { at: number; message: string; variant: ToastVariant }[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function useWorkspaceBuilds(workspaceId: string) {
  return useSyncExternalStore(subscribe, () => buildsByWorkspace.get(workspaceId));
}

// Toasts need a mounted component; any plugin surface on screen shows queued notices once.
export function useBuildNotices() {
  const toast = useToast();
  useEffect(() => {
    const drain = () => {
      for (const notice of notices.splice(0)) {
        if (Date.now() - notice.at < NOTICE_MAX_AGE_MS) {
          toast.show(notice.message, { variant: notice.variant });
        }
      }
    };
    drain();
    return subscribe(drain);
  }, [toast]);
}

function HeaderIcon({ theme, size, workspaceId }: PluginButtonIconProps) {
  useBuildNotices();
  const builds = useWorkspaceBuilds(workspaceId) ?? [];
  const presentation = worst(builds.map((build) => present(build.state)));
  return <StatusIcon theme={theme} presentation={presentation} size={size} />;
}

function noticeFor(build: BuildkiteBuildSummary, workspace: string) {
  const variant: ToastVariant =
    build.state === "passed" ? "success" : build.state === "failed" ? "error" : "default";
  return {
    at: Date.now(),
    variant,
    message: `${build.pipelineName} #${build.number} ${stateLabel(build.state)} · ${workspace}`,
  };
}

export function installHeaderStatus(client: PluginClientContext): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  let warnedAboutExpiry = false;
  const workspaces = new Map<string, { directory: string; name: string }>();
  const buttons = new Map<string, PluginButtonRegistration>();

  const track = (workspace: PaseoWorkspace) => {
    if (workspace.projectKind !== "git" || workspace.archivingAt) return untrack(workspace.id);
    workspaces.set(workspace.id, {
      directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
      name: workspace.title ?? workspace.name,
    });
    if (buttons.has(workspace.id)) return;
    buttons.set(
      workspace.id,
      client.addHeaderButton({
        id: "status",
        workspaceId: workspace.id,
        button: {
          title: "Buildkite build status",
          icon: HeaderIcon,
          // Shown once a build exists, so repositories without Buildkite stay uncluttered.
          visible: (buildsByWorkspace.get(workspace.id)?.length ?? 0) > 0,
          behavior: {
            kind: "action",
            onPress() {
              client.openPanel("status", { workspaceId: workspace.id, location: "explorer" });
            },
          },
        },
      }),
    );
  };

  function untrack(workspaceId: string) {
    workspaces.delete(workspaceId);
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
    buildsByWorkspace.delete(workspaceId);
  }

  async function poll() {
    let delay = IDLE_POLL_MS;
    try {
      const tracked = [...workspaces];
      const directories = [...new Set(tracked.map(([, { directory }]) => directory))];
      const { signedIn, token, results } = directories.length
        ? await client.rpc(statusesRpc, { directories })
        : { signedIn: false, token: null, results: [] };
      // Once per app session, so an expiring token is noticed before it stops working.
      const warning = expiryWarning(token?.expiresAt);
      if (warning && !warnedAboutExpiry) {
        warnedAboutExpiry = true;
        notices.push({
          at: Date.now(),
          variant: "warning",
          message: `${warning} Replace it in Settings → Plugins → Buildkite.`,
        });
      }
      const byDirectory = new Map(results.map((result) => [result.directory, result.builds]));
      for (const [workspaceId, { directory, name }] of tracked) {
        const builds = signedIn ? (byDirectory.get(directory) ?? []) : [];
        // Only builds seen running earlier notify, so opening Paseo does not replay history.
        for (const build of builds) {
          const before = buildsByWorkspace.get(workspaceId)?.find(({ id }) => id === build.id);
          if (before && isActive(before.state) && !isActive(build.state)) {
            notices.push(noticeFor(build, name));
          }
        }
        buildsByWorkspace.set(workspaceId, builds);
        buttons.get(workspaceId)?.update({ visible: builds.length > 0 });
        if (builds.some(({ state }) => isActive(state))) delay = ACTIVE_POLL_MS;
      }
      emit();
    } catch (error) {
      console.warn("[buildkite-status] status poll failed:", error);
    }
    if (!stopped) timer = setTimeout(poll, delay);
  }

  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (stopped) return void subscription.release();
      const unsubscribe = subscription.subscribe({
        snapshot: ({ entries }) => {
          const seen = new Set(entries.map(({ id }) => id));
          for (const id of [...workspaces.keys()]) if (!seen.has(id)) untrack(id);
          entries.forEach(track);
          if (timer === undefined) void poll();
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "upsert") track(update.workspace);
          else untrack(update.id);
        },
      });
      release = () => {
        unsubscribe();
        void subscription.release();
      };
    })
    .catch((error) => console.warn("[buildkite-status] workspace list failed:", error));

  return () => {
    stopped = true;
    clearTimeout(timer);
    release?.();
    for (const id of [...workspaces.keys()]) untrack(id);
  };
}
