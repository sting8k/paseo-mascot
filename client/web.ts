import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only the globals this module uses.
declare const document: { body: unknown };

declare const window: {
  addEventListener(
    type: "mousemove",
    listener: (event: { clientX: number; clientY: number }) => void,
  ): void;
  removeEventListener(
    type: "mousemove",
    listener: (event: { clientX: number; clientY: number }) => void,
  ): void;
};
declare function requestAnimationFrame(callback: () => void): number;
declare function getComputedStyle(element: unknown): { overflow: string };
declare function cancelAnimationFrame(handle: number): void;

export interface CursorTracker {
  dispose(): void;
}

/**
 * Subscribe to cursor moves on web; no-op on native, where there is no cursor.
 * Deliveries are coalesced to one callback per animation frame.
 */
export function trackCursor(onMove: (x: number, y: number) => void): CursorTracker {
  if (Platform.OS !== "web") {
    return { dispose: () => {} };
  }
  let handle = 0;
  let latest: { x: number; y: number } | null = null;
  const listener = (event: { clientX: number; clientY: number }) => {
    latest = { x: event.clientX, y: event.clientY };
    if (!handle) {
      handle = requestAnimationFrame(() => {
        handle = 0;
        if (latest) onMove(latest.x, latest.y);
      });
    }
  };
  window.addEventListener("mousemove", listener);
  return {
    dispose() {
      window.removeEventListener("mousemove", listener);
      if (handle) cancelAnimationFrame(handle);
    },
  };
}

/**
 * Measure a mounted element's screen-center into `target`.
 * Web refs expose getBoundingClientRect; native refs fall back to measureInWindow.
 * Safe to call per cursor tick — getBoundingClientRect is cheap enough here
 * (the koboyo component does the same).
 */
export function measureCenterInto(
  node: unknown,
  target: { x: number; y: number },
): void {
  const el = node as {
    getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
    measureInWindow?: (
      cb: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  } | null;
  if (!el) return;
  if (typeof el.getBoundingClientRect === "function") {
    const rect = el.getBoundingClientRect();
    if (rect.width || rect.height) {
      target.x = rect.left + rect.width / 2;
      target.y = rect.top + rect.height / 2;
    }
    return;
  }
  el.measureInWindow?.((x, y, width, height) => {
    if (x || y || width || height) {
      target.x = x + width / 2;
      target.y = y + height / 2;
    }
  });
}

interface HostNode {
  parentElement: HostNode | null;
  tagName: string;
  children: { length: number; item(index: number): HostNode | null };
  style: {
    overflow: string;
    display: string;
    cssText: string;
    setProperty(property: string, value: string, priority?: string): void;
  };
}

/**
 * Paseo renders a plugin composer pill as a BUTTON with chrome (background, border,
 * label) around a fixed 16px icon box with `overflow: hidden`
 * (packages/app/src/plugins/buttons/view.tsx). Plugin clients run in the host window,
 * so for our own button we open that clip and strip the chrome, leaving just the
 * mascot perched on the composer. Ancestors are found by behaviour (walk to the
 * BUTTON), never by class name, and every touched node is restored on unmount.
 * Returns the host button (the popover's anchor) plus a restore function.
 */
export function perchOnHostButton(node: unknown): { button: unknown; restore: () => void } {
  const noop = { button: null, restore: () => {} };
  if (Platform.OS !== "web") return noop;
  const start = node as HostNode | null;
  if (!start) return noop;

  const patched: { el: HostNode; css: string }[] = [];
  const patch = (el: HostNode, apply: (el: HostNode) => void) => {
    patched.push({ el, css: el.style.cssText });
    apply(el);
  };

  const chain: HostNode[] = [];
  let current = start.parentElement;
  let button: HostNode | null = null;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    chain.push(current);
    if (current.tagName === "BUTTON") {
      button = current;
      break;
    }
    current = current.parentElement;
  }

  for (const el of chain) {
    if (getComputedStyle(el).overflow !== "visible") patch(el, (e) => (e.style.overflow = "visible"));
  }

  // The icon box is a fixed 16px square rendered with `pointerEvents="none"`. Let it
  // take our slot's size and accept the pointer, so the mascot is both as large as the
  // hit area and directly grabbable; clicks still bubble to the button.
  const iconBox = chain[0];
  if (iconBox) {
    patch(iconBox, (e) => {
      e.style.cssText += ";width:auto;height:auto";
      // react-native-web writes `pointer-events: none !important` for the host's
      // `pointerEvents="none"`, so plain inline styles lose to it.
      e.style.setProperty("pointer-events", "auto", "important");
    });
  }
  patch(start, (e) => e.style.setProperty("pointer-events", "auto", "important"));

  if (button) {
    patch(button, (e) => {
      e.style.cssText +=
        ";background:transparent;border-color:transparent;box-shadow:none;padding:0;min-height:0";
      // Composer chrome would otherwise paint over a mascot dragged across it.
      e.style.setProperty("z-index", "2147483000", "important");
    });
  }

  // Hide the pill's own content (label, chevron) — everything that is not our subtree.
  const ours = new Set<HostNode>([start, ...chain]);
  for (const el of chain) {
    for (let index = 0; index < el.children.length; index += 1) {
      const child = el.children.item(index);
      if (child && !ours.has(child)) patch(child, (e) => (e.style.display = "none"));
    }
  }

  return {
    button,
    restore: () => {
      for (const entry of patched) entry.el.style.cssText = entry.css;
    },
  };
}

interface ObservedNode {
  style?: { setProperty(property: string, value: string, priority?: string): void };
  textContent: string | null;
}

declare class MutationObserver {
  constructor(callback: (records: { addedNodes: { length: number; item(i: number): ObservedNode | null } }[]) => void);
  observe(target: unknown, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}

/**
 * The host wraps every plugin button in a tooltip that repeats `button.title`, rendered
 * through a portal into the overlay root — so it cannot be stopped at the button. With
 * the mascot standing on its own, that bubble is pure noise: hide any tooltip node whose
 * text is exactly our title, and stop when the pill goes away.
 */
export function suppressHostTooltip(title: string): () => void {
  if (Platform.OS !== "web") return () => {};
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (let index = 0; index < record.addedNodes.length; index += 1) {
        const node = record.addedNodes.item(index);
        if (node?.style && node.textContent?.trim() === title) {
          node.style.setProperty("display", "none", "important");
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
