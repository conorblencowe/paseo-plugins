import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { runningRpc } from "../shared/docker";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface DomElement {
  readonly style: Record<string, string>;
  innerHTML: string;
  readonly parentElement: DomElement | null;
  readonly nextSibling: DomElement | null;
  readonly nextElementSibling: DomElement | null;
  readonly firstElementChild: DomElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selectors: string): DomElement | null;
  insertBefore(child: DomElement, reference: DomElement | null): DomElement;
  remove(): void;
}
declare const document: {
  readonly body: DomElement;
  createElement(tagName: string): DomElement;
  querySelectorAll(selectors: string): Iterable<DomElement>;
};
declare const MutationObserver: new (callback: () => void) => {
  observe(target: DomElement, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
};
declare function getComputedStyle(element: DomElement): { color: string };

// Paseo has no plugin API for sidebar workspace rows, so this targets the app's own test IDs:
// `sidebar-workspace-row-<serverId>:<workspaceId>`, and `workspace-status-indicator-<status>` inside it,
// whose next sibling is the column holding the title line. The trailing timestamp or diff stat
// depends on a sidebar setting, so it can't be the anchor.
const ROW_PREFIX = "sidebar-workspace-row-";
const STATUS_INDICATOR = '[data-testid^="workspace-status-indicator-"]';
const ICON_ATTR = "data-docker-stack-indicator";
const POLL_MS = 15_000;
// Lucide "container", as bundled by Paseo.
const CONTAINER_ICON =
  '<path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"/>' +
  '<path d="M10 21.9V14L2.1 9.1"/><path d="m10 14 11.9-6.9"/><path d="M14 19.8v-8.1"/><path d="M18 17.5V9.4"/>';

let refreshNow = () => {};
// Lets the panel update the sidebar straight after a down instead of waiting for the next poll.
export const refreshSidebarIndicators = () => refreshNow();

// shortcut: polls the selected host only, so rows of other connected hosts get no indicator;
// track per-row serverId with getPaseoClient if multi-host matters.
export function installSidebarIndicators(client: PluginClientContext): () => void {
  if (Platform.OS !== "web") return () => {};

  let running = new Map<string, number>();
  let stopped = false;

  const render = () => {
    for (const row of document.querySelectorAll(`[data-testid^="${ROW_PREFIX}"]`)) {
      const key = row.getAttribute("data-testid")!.slice(ROW_PREFIX.length);
      const count = running.get(key.slice(key.indexOf(":") + 1));
      const existing = row.querySelector(`[${ICON_ATTR}]`);
      if (!count) {
        existing?.remove();
        continue;
      }
      // Sit right after the title text in the title line, so the title truncates around the icon.
      const titleLine = row.querySelector(STATUS_INDICATOR)?.nextElementSibling?.firstElementChild;
      const titleText = titleLine?.firstElementChild;
      if (!titleLine || !titleText || titleText === existing) continue;
      const icon = existing ?? createIcon(getComputedStyle(titleText).color);
      const title = `Docker stack running (${count} container${count === 1 ? "" : "s"})`;
      if (icon.getAttribute("title") !== title) icon.setAttribute("title", title);
      if (titleText.nextSibling !== icon) titleLine.insertBefore(icon, titleText.nextSibling);
    }
  };

  const poll = async () => {
    try {
      const { workspaces } = await client.rpc(runningRpc, {});
      running = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.running]));
    } catch (error) {
      console.warn("[docker-stack] Running stacks poll failed", error);
    }
    if (!stopped) render();
  };
  refreshNow = () => void poll();

  const observer = new MutationObserver(render);
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(poll, POLL_MS);
  void poll();

  return () => {
    stopped = true;
    refreshNow = () => {};
    clearInterval(timer);
    observer.disconnect();
    for (const icon of document.querySelectorAll(`[${ICON_ATTR}]`)) icon.remove();
  };
}

function createIcon(color: string): DomElement {
  const icon = document.createElement("div");
  icon.setAttribute(ICON_ATTR, "");
  Object.assign(icon.style, { display: "flex", alignItems: "center", alignSelf: "center", flexShrink: "0", marginLeft: "4px", opacity: "0.6" });
  icon.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CONTAINER_ICON}</svg>`;
  return icon;
}
