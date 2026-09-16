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
export function makeDraggable(
  handle: unknown,
  moved: unknown,
  onDrop: (position: Point) => void,
): () => void {
  if (Platform.OS !== "web") return () => {};
  const el = handle as DragNode | null;
  const target = (moved as DragNode | null) ?? el;
  if (!el || !target) return () => {};

  let origin: { pointer: Point; node: Point } | null = null;
  let dragging = false;

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
    dragging = true;
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
    onDrop({ x: rect.left, y: rect.top });
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
