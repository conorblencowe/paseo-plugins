import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface DomEvent {
  stopPropagation(): void;
  preventDefault(): void;
}
interface DomElement {
  readonly style: Record<string, string>;
  innerHTML: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selectors: string): DomElement | null;
  closest(selectors: string): DomElement | null;
  appendChild(child: DomElement): DomElement;
  remove(): void;
  click(): void;
  addEventListener(type: string, listener: (event: DomEvent) => void): void;
  readonly parentElement: DomElement | null;
}
declare const document: {
  readonly body: DomElement;
  createElement(tagName: string): DomElement;
  querySelector(selectors: string): DomElement | null;
  querySelectorAll(selectors: string): Iterable<DomElement>;
};
declare const MutationObserver: new (callback: () => void) => {
  observe(target: DomElement, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
};

// Paseo has no plugin API for sidebar workspace rows, so this targets the app's own test IDs.
const KEBAB_PREFIX = "sidebar-workspace-kebab-";
const BUTTON_ATTR = "data-sidebar-archive-button";
const ARCHIVE_ICON =
  '<rect width="20" height="5" x="2" y="3" rx="1"/>' +
  '<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>' +
  '<path d="M10 12h4"/>';

export function installSidebarArchiveButtons(): () => void {
  if (Platform.OS !== "web") return () => {};

  // The kebab only mounts while a row is hovered, so add the button whenever one appears.
  const inject = () => {
    for (const kebab of document.querySelectorAll(`[data-testid^="${KEBAB_PREFIX}"]`)) {
      const container = kebab.parentElement;
      if (container && !container.querySelector(`[${BUTTON_ATTR}]`)) {
        container.appendChild(createButton(kebab));
      }
    }
  };
  const observer = new MutationObserver(inject);
  observer.observe(document.body, { childList: true, subtree: true });
  inject();

  return () => {
    observer.disconnect();
    for (const button of document.querySelectorAll(`[${BUTTON_ATTR}]`)) button.remove();
  };
}

function createButton(kebab: DomElement): DomElement {
  const kebabIcon = kebab.querySelector("svg");
  const size = kebabIcon?.getAttribute("width") ?? "16";
  const color =
    kebabIcon?.getAttribute("stroke") ??
    kebabIcon?.querySelector("[stroke]")?.getAttribute("stroke") ??
    "currentColor";
  // Match the row's hover backdrop so trailing text (diff stats, timestamps) doesn't show through.
  const backdrop = kebab
    .closest('[data-testid^="sidebar-workspace-row-"]')
    ?.querySelector('[data-testid="sidebar-workspace-trailing-scrim"] stop:last-child')
    ?.getAttribute("stop-color");

  const button = document.createElement("div");
  button.setAttribute(BUTTON_ATTR, "");
  button.setAttribute("role", "button");
  button.setAttribute("aria-label", "Archive workspace");
  button.setAttribute("title", "Archive workspace");
  Object.assign(button.style, {
    position: "absolute",
    top: "0",
    right: "100%",
    display: "flex",
    alignItems: "center",
    height: "100%",
    paddingLeft: backdrop ? "12px" : "0",
    paddingRight: "4px",
    background: backdrop ? `linear-gradient(to right, transparent, ${backdrop} 12px)` : "none",
    cursor: "pointer",
    opacity: "0.7",
  });
  button.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${ARCHIVE_ICON}</svg>`;

  button.addEventListener("mouseenter", () => (button.style.opacity = "1"));
  button.addEventListener("mouseleave", () => (button.style.opacity = "0.7"));
  // Keep presses away from the row, which would otherwise open the workspace or start a drag.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    button.addEventListener(type, (event) => event.stopPropagation());
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    void archiveViaMenu(kebab);
  });
  return button;
}

// Select the kebab menu's own Archive item so Paseo's confirmation for risky worktrees still runs.
async function archiveViaMenu(kebab: DomElement): Promise<void> {
  const key = kebab.getAttribute("data-testid")?.slice(KEBAB_PREFIX.length);
  if (!key) return;
  kebab.click();
  const selector = `[data-testid="sidebar-workspace-menu-archive-${key}"]`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const item = document.querySelector(selector);
    if (item) {
      item.click();
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  console.warn("[sidebar-archive-button] Archive menu item not found for", key);
}
