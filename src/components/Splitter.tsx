// A draggable edge between two areas, used for the console, its typing
// box, the right column, and the panes inside it. It is a standard
// separator with its value exposed, so screen readers announce the size,
// and it moves with the arrow keys once it has focus (WAI-ARIA window
// splitter pattern). While dragging, text selection is switched off, so
// the drag never paints a selection across the window.

import type { KeyboardEvent, PointerEvent } from "react";

type Props = {
  label: string;
  /** "row" resizes a height, dragging up and down. "column" resizes a
   * width, dragging left and right. */
  axis: "row" | "column";
  value: number;
  min: number;
  max: number;
  /** True when dragging up or left should make the value larger, as for
   * an area that sits below or to the right of its edge. */
  grows?: boolean;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  className?: string;
};

export function Splitter({ label, axis, value, min, max, grows = true, step = 24, unit = "pixels", onChange, className = "" }: Props) {
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Keeps the press from starting a text selection.
    event.preventDefault();
    const origin = axis === "row" ? event.clientY : event.clientX;
    const start = value;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add(axis === "row" ? "is-resizing-rows" : "is-resizing-columns");
    const move = (moved: globalThis.PointerEvent) => {
      const delta = (axis === "row" ? moved.clientY : moved.clientX) - origin;
      onChange(clamp(start + (grows ? -delta : delta)));
    };
    const up = () => {
      document.body.classList.remove("is-resizing-rows", "is-resizing-columns");
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The arrow that points away from the area makes it larger, matching
    // the direction a pointer would drag.
    const bigger = axis === "row" ? (grows ? "ArrowUp" : "ArrowDown") : grows ? "ArrowLeft" : "ArrowRight";
    const smaller = axis === "row" ? (grows ? "ArrowDown" : "ArrowUp") : grows ? "ArrowRight" : "ArrowLeft";
    if (event.key === bigger) onChange(clamp(value + step));
    else if (event.key === smaller) onChange(clamp(value - step));
    else if (event.key === "Home") onChange(min);
    else if (event.key === "End") onChange(max);
    else return;
    event.preventDefault();
  }

  return (
    <div
      className={`splitter is-${axis} ${className}`}
      role="separator"
      // A separator that resizes rows lies across them, horizontally.
      aria-orientation={axis === "row" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} ${unit}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className="grip" aria-hidden="true" />
    </div>
  );
}
