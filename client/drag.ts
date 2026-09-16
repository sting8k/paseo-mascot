import { Platform } from "react-native";

export interface Point {
  x: number;
  y: number;
}

interface DragNode {
  parentElement: DragNode | null;
  nextSibling: DragNode | null;
  appendChild(child: DragNode): void;
  insertBefore(child: DragNode, before: DragNode | null): void;
  style: { cssText: string; left: string; top: string; position: string; cursor: string };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(type: string, listener: (event: PointerLike) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: PointerLike) => void, options?: unknown): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId: number;
  button?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

declare const document: { body: DragNode };

declare const window: {
  innerWidth: number;
  innerHeight: number;
  addEventListener(type: string, listener: (event: PointerLike) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: PointerLike) => void, options?: unknown): void;
};

const DRAG_THRESHOLD_PX = 4;
/** px/ms at release that counts as a throw rather than a placement. */
const FLING_SPEED = 1.2;
/** Dropped this close to the composer row, the mascot climbs back onto its perch. */
const SNAP_HOME_PX = 48;

export interface DragHandlers {
  /** The press turned into a real drag. */
  onStart?(): void;
  /** Resting place — `null` means back on the composer perch — plus whether it was thrown. */
  onDrop(position: Point | null, flung: boolean): void;
}

/** Keep a dragged mascot fully inside the viewport, even after a window resize. */
export function clampToViewport(position: Point, size: number): Point {
  const maxX = Math.max(0, window.innerWidth - size);
  const maxY = Math.max(0, window.innerHeight - size);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
  };
}

/**
 * A pinned mascot has to escape the composer's stacking context, or the chat box paints
 * over it. Re-parent it to the app's root container — still inside the React root, so
 * the host's own click handling keeps working — and put it back exactly where it was
 * when it is unpinned or unmounted.
 */
const lifted = new WeakMap<DragNode, { parent: DragNode; before: DragNode | null }>();

function liftToRoot(el: DragNode): void {
  if (lifted.has(el) || !el.parentElement) return;
  let root: DragNode = el;
  while (root.parentElement && root.parentElement !== document.body) root = root.parentElement;
  if (root === el) return;
  lifted.set(el, { parent: el.parentElement, before: el.nextSibling });
  root.appendChild(el);
}

/**
 * Once pinned, a mascot could never find its way back to the composer: `position` only
 * ever changed to another free spot. A drop close to where the perch *would be* reads as
 * "put it back". The emptied slot and its wrappers collapse to 0px and drift as the
 * composer relayouts, so the only honest measurement is to seat the node back in its
 * slot, read the rect, and lift it again — all synchronously, so no frame shows it.
 */
function droppedHome(el: DragNode, rect: { left: number; top: number; width: number; height: number }): boolean {
  const home = lifted.get(el);
  if (!home) return false;
  const fixed = { position: el.style.position, left: el.style.left, top: el.style.top };
  home.parent.insertBefore(el, home.before);
  el.style.position = "";
  el.style.left = "";
  el.style.top = "";
  const perch = el.getBoundingClientRect();
  el.style.position = fixed.position;
  el.style.left = fixed.left;
  el.style.top = fixed.top;
  let root: DragNode = el;
  while (root.parentElement && root.parentElement !== document.body) root = root.parentElement;
  root.appendChild(el);
  const dx = rect.left + rect.width / 2 - (perch.left + perch.width / 2);
  const dy = rect.top + rect.height / 2 - (perch.top + perch.height / 2);
  return Math.hypot(dx, dy) <= SNAP_HOME_PX;
}

function dropFromRoot(el: DragNode): void {
  const home = lifted.get(el);
  if (!home) return;
  lifted.delete(el);
  home.parent.insertBefore(el, home.before);
}

/** Pin the node at viewport coordinates, or hand it back to normal layout with `null`. */
export function applyFixedPosition(node: unknown, position: Point | null): void {
  if (Platform.OS !== "web") return;
  const el = node as DragNode | null;
  if (!el) return;
  if (!position) {
    dropFromRoot(el);
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    return;
  }
  liftToRoot(el);
  el.style.position = "fixed";
  el.style.left = `${position.x}px`;
  el.style.top = `${position.y}px`;
}

/**
 * Drag the mascot anywhere in the window. A press that never passes the threshold is
 * left alone so it still reaches the host button (which opens the picker); a real drag
 * swallows the click that would otherwise follow.
 */
export function makeDraggable(handle: unknown, moved: unknown, handlers: DragHandlers): () => void {
  if (Platform.OS !== "web") return () => {};
  const el = handle as DragNode | null;
  const target = (moved as DragNode | null) ?? el;
  if (!el || !target) return () => {};

  let origin: { pointer: Point; node: Point } | null = null;
  let dragging = false;
  let last = { x: 0, y: 0, at: 0 };
  let speed = 0;

  const swallowClick = (event: PointerLike) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerDown = (event: PointerLike) => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = target.getBoundingClientRect();
    origin = {
      pointer: { x: event.clientX, y: event.clientY },
      node: { x: rect.left, y: rect.top },
    };
    dragging = false;
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is an optimisation; window listeners already cover the drag.
    }
  };

  const onPointerMove = (event: PointerLike) => {
    if (!origin) return;
    const dx = event.clientX - origin.pointer.x;
    const dy = event.clientY - origin.pointer.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!dragging) {
      dragging = true;
      last = { x: event.clientX, y: event.clientY, at: Date.now() };
      handlers.onStart?.();
    }
    const now = Date.now();
    const elapsed = now - last.at;
    if (elapsed > 0) {
      speed = Math.hypot(event.clientX - last.x, event.clientY - last.y) / elapsed;
      last = { x: event.clientX, y: event.clientY, at: now };
    }
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    applyFixedPosition(
      target,
      clampToViewport({ x: origin.node.x + dx, y: origin.node.y + dy }, rect.width),
    );
  };

  const onPointerUp = () => {
    if (!origin) return;
    const wasDragging = dragging;
    origin = null;
    dragging = false;
    if (!wasDragging) return;
    // Cancel the click this drag would produce, then report the resting place.
    el.addEventListener("click", swallowClick, { capture: true, once: true });
    const rect = target.getBoundingClientRect();
    handlers.onDrop(droppedHome(target, rect) ? null : { x: rect.left, y: rect.top }, speed >= FLING_SPEED);
    speed = 0;
  };

  el.style.cursor = "grab";
  el.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  return () => {
    el.style.cursor = "";
    el.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
}
