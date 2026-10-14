import { Platform } from "react-native";
import { type AgentBucket, type AgentNode, createAgentStore } from "./agents";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface DomEvent {
  stopPropagation(): void;
  preventDefault(): void;
}
interface DomElement {
  readonly style: Record<string, string>;
  textContent: string | null;
  innerHTML: string;
  readonly isConnected: boolean;
  readonly parentElement: DomElement | null;
  readonly nextSibling: DomElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selectors: string): DomElement | null;
  appendChild(child: DomElement): DomElement;
  insertBefore(child: DomElement, reference: DomElement | null): DomElement;
  replaceChildren(...children: DomElement[]): void;
  remove(): void;
  click(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
  animate(
    keyframes: Record<string, string[]>,
    options: { duration: number; easing: string; iterations: number },
  ): { startTime: number | null };
}
declare const document: {
  readonly body: DomElement;
  createElement(tagName: string): DomElement;
  createElementNS(namespace: string, tagName: string): DomElement;
  querySelector(selectors: string): DomElement | null;
  querySelectorAll(selectors: string): Iterable<DomElement>;
};
declare const MutationObserver: new (callback: () => void) => {
  observe(target: DomElement, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
};
declare function getComputedStyle(element: DomElement): {
  color: string;
  fontFamily: string;
  backgroundColor: string;
};
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

// Paseo has no plugin API for sidebar workspace rows, so this targets the app's own test IDs:
// `sidebar-workspace-row-<serverId>:<workspaceId>` for rows and `workspace-tab-agent_<agentId>`
// for agent tabs.
const ROW_PREFIX = "sidebar-workspace-row-";
const TAB_PREFIX = "workspace-tab-agent_";
const TREE_ATTR = "data-sidebar-agent-tree";
const COLLAPSED_KEY = "sidebar-agent-tree:collapsed";
// A single agent is already summarised by the row's own status indicator.
const MIN_AGENTS = 2;

const LABELS: Record<AgentBucket, string> = {
  needs_input: "Needs input",
  failed: "Error",
  running: "Running",
  attention: "Finished",
  done: "Idle",
};

// Paseo's built-in status colours (theme.colors.statusDot*) for its light and dark themes.
type Palette = Record<Exclude<AgentBucket, "done">, string>;
const LIGHT: Palette = { needs_input: "#b37824", failed: "#f12e2f", running: "#268ae0", attention: "#299f51" };
const DARK: Palette = { needs_input: "#db932e", failed: "#f7796d", running: "#5caaf6", attention: "#35c264" };

// Paseo's StatusRing geometry and timing. Its rings start at time 0, so ours spin in phase.
const DOT_SIZE = 6;
const RING_SIZE = 12;
const RING_STROKE = 1.5;
const RING_FRAME_SIZE = 14;
const RING_PERIOD_MS = 900;
const ALERT_SIZE = 12;

interface Tree {
  element: DomElement;
  signature: string;
}

export function installSidebarAgentTree(): () => void {
  if (Platform.OS !== "web") return () => {};

  const trees = new Map<DomElement, Tree>();
  const collapsed = new Set<string>(readCollapsed());
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      render();
    }, 0);
  };
  const store = createAgentStore(schedule);

  function render(): void {
    const seen = new Set<DomElement>();
    for (const row of document.querySelectorAll(`[data-testid^="${ROW_PREFIX}"]`)) {
      const key = row.getAttribute("data-testid")?.slice(ROW_PREFIX.length) ?? "";
      const split = key.indexOf(":");
      const container = row.parentElement;
      if (split < 1 || !container?.parentElement) continue;
      const serverId = key.slice(0, split);
      const workspaceId = key.slice(split + 1);
      store.track(serverId);
      const agents = store.agentsFor(serverId, workspaceId);
      if (agents.length < MIN_AGENTS) continue;
      seen.add(row);

      let tree = trees.get(row);
      if (!tree) {
        tree = { element: createTree(), signature: "" };
        trees.set(row, tree);
      }
      // Sit beside the row's container, outside its hover card, drag handle and press target.
      if (container.nextSibling !== tree.element) {
        container.parentElement.insertBefore(tree.element, container.nextSibling);
      }
      const expanded = !collapsed.has(key);
      const signature = JSON.stringify([expanded, agents]);
      if (signature !== tree.signature) {
        tree.signature = signature;
        fillTree(tree.element, row, key, agents, expanded);
      }
    }
    for (const [row, tree] of trees) {
      if (seen.has(row) && row.isConnected) continue;
      tree.element.remove();
      trees.delete(row);
    }
  }

  function toggle(key: string): void {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    render();
  }

  function fillTree(
    tree: DomElement,
    row: DomElement,
    key: string,
    agents: AgentNode[],
    expanded: boolean,
  ): void {
    // Copy the row title's colour and font so the tree matches every theme.
    const title = row.querySelector('[dir="auto"]');
    const computed = title ? getComputedStyle(title) : null;
    tree.style.color = computed?.color ?? "inherit";
    tree.style.fontFamily = computed?.fontFamily ?? "inherit";
    // Light text means a dark theme. The alert's "!" is cut out in the sidebar's background colour.
    const palette = isLight(computed?.color) ? DARK : LIGHT;
    const cutout = backgroundOf(row);

    const waiting = agents.filter((agent) => agent.bucket !== "done").length;
    const summary = `${agents.length} agents${waiting ? ` · ${waiting} active` : ""}`;
    const header = createRow(() => toggle(key));
    header.setAttribute("aria-expanded", String(expanded));
    header.style.opacity = "0.6";
    header.appendChild(createChevron(expanded));
    header.appendChild(createText(summary));

    const rows = expanded
      ? agents.map((agent) => {
          const item = createRow(() => void openAgent(row, agent.id));
          item.style.paddingLeft = "18px";
          item.setAttribute("title", `${agent.title} (${LABELS[agent.bucket]})`);
          item.appendChild(createIndicator(agent.bucket, palette, cutout));
          const label = createText(agent.title);
          label.style.flex = "1";
          label.style.opacity = agent.bucket === "done" ? "0.6" : "0.9";
          item.appendChild(label);
          if (agent.bucket !== "done") {
            const status = createText(LABELS[agent.bucket]);
            status.style.opacity = "0.55";
            status.style.flexShrink = "0";
            item.appendChild(status);
          }
          return item;
        })
      : [];
    tree.replaceChildren(header, ...rows);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  render();

  return () => {
    observer.disconnect();
    store.dispose();
    for (const tree of trees.values()) tree.element.remove();
    trees.clear();
    for (const stray of document.querySelectorAll(`[${TREE_ATTR}]`)) stray.remove();
  };
}

function createTree(): DomElement {
  const tree = document.createElement("div");
  tree.setAttribute(TREE_ATTR, "");
  tree.setAttribute("role", "group");
  Object.assign(tree.style, {
    display: "flex",
    flexDirection: "column",
    padding: "0 8px 4px 26px",
    fontSize: "12px",
    lineHeight: "18px",
  });
  // Keep presses away from the sidebar list, which would otherwise start a drag or navigate.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    tree.addEventListener(type, (event) => event.stopPropagation());
  }
  return tree;
}

function createRow(onPress: () => void): DomElement {
  const row = document.createElement("div");
  row.setAttribute("role", "button");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: "0",
    padding: "1px 6px",
    borderRadius: "6px",
    cursor: "pointer",
  });
  row.addEventListener("mouseenter", () => (row.style.backgroundColor = "rgba(128, 128, 128, 0.14)"));
  row.addEventListener("mouseleave", () => (row.style.backgroundColor = "transparent"));
  row.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    onPress();
  });
  return row;
}

function createText(text: string): DomElement {
  const span = document.createElement("span");
  span.textContent = text;
  Object.assign(span.style, {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  return span;
}

// Rebuilds the sidebar's own status indicators, which plugins can't import.
function createIndicator(bucket: AgentBucket, palette: Palette, cutout: string): DomElement {
  const slot = document.createElement("span");
  Object.assign(slot.style, {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${RING_FRAME_SIZE}px`,
    height: "16px",
    flexShrink: "0",
  });
  if (bucket === "running") {
    slot.appendChild(createRing(palette.running));
  } else if (bucket === "needs_input") {
    slot.appendChild(createAlert(palette.needs_input, cutout));
  } else {
    const dot = createCircle(DOT_SIZE);
    dot.style.backgroundColor = bucket === "done" ? "currentColor" : palette[bucket];
    if (bucket === "done") dot.style.opacity = "0.3";
    slot.appendChild(dot);
  }
  return slot;
}

function createRing(color: string): DomElement {
  const frame = createCircle(RING_FRAME_SIZE);
  Object.assign(frame.style, { display: "flex", alignItems: "center", justifyContent: "center" });
  const track = createCircle(RING_SIZE);
  Object.assign(track.style, { position: "absolute", border: `${RING_STROKE}px solid ${color}`, opacity: "0.3" });
  const rotator = document.createElement("span");
  Object.assign(rotator.style, { position: "absolute", width: `${RING_SIZE}px`, height: `${RING_SIZE}px` });
  const arc = createCircle(RING_SIZE);
  Object.assign(arc.style, {
    display: "block",
    border: `${RING_STROKE}px solid transparent`,
    borderTopColor: color,
    opacity: "0.9",
  });
  rotator.appendChild(arc);
  const center = createCircle(DOT_SIZE);
  center.style.backgroundColor = color;
  frame.appendChild(track);
  frame.appendChild(rotator);
  frame.appendChild(center);
  const spin = rotator.animate(
    { transform: ["rotate(0deg)", "rotate(360deg)"] },
    { duration: RING_PERIOD_MS, easing: "linear", iterations: Number.POSITIVE_INFINITY },
  );
  spin.startTime = 0;
  return frame;
}

// Lucide CircleAlert, filled like the sidebar's needs-input indicator.
function createAlert(color: string, cutout: string): DomElement {
  const svg = createSvg(ALERT_SIZE, color, cutout);
  svg.innerHTML =
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/>' +
    '<line x1="12" x2="12.01" y1="16" y2="16"/>';
  return svg;
}

function createCircle(size: number): DomElement {
  const circle = document.createElement("span");
  Object.assign(circle.style, {
    boxSizing: "border-box",
    width: `${size}px`,
    height: `${size}px`,
    flexShrink: "0",
    borderRadius: "50%",
  });
  return circle;
}

function createChevron(expanded: boolean): DomElement {
  const svg = createSvg(12, "none", "currentColor");
  svg.style.transform = expanded ? "rotate(90deg)" : "none";
  svg.innerHTML = '<path d="m9 18 6-6-6-6"/>';
  return svg;
}

// A Lucide-style 24x24 icon.
function createSvg(size: number, fill: string, stroke: string): DomElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill,
    stroke,
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  })) {
    svg.setAttribute(name, value);
  }
  svg.style.flexShrink = "0";
  return svg;
}

function isLight(color: string | undefined): boolean {
  const [r = 0, g = 0, b = 0] = (color?.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

// The first opaque background behind the row: the sidebar's own colour.
function backgroundOf(element: DomElement): string {
  for (let node: DomElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "#fff";
}

// Open the workspace through its own row, then select the agent's tab, so Paseo's navigation runs.
async function openAgent(row: DomElement, agentId: string): Promise<void> {
  if (row.getAttribute("aria-selected") !== "true") row.click();
  const selector = `[data-testid="${TAB_PREFIX}${agentId}"]`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const tab = document.querySelector(selector);
    if (tab) {
      tab.click();
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  console.warn("[sidebar-agent-tree] No open tab found for agent", agentId);
}

function readCollapsed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
