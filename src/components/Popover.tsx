// A small menu that opens from a button. It closes on Escape, Tab, or a
// click outside, gives focus back to the button that opened it, and moves
// between its items with the arrow keys, Home, and End, as native menus do.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

/** Open state for a menu, and the box that holds its button and items. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The control that opened the menu, which may be the arrow half of a
    // split button. Read from the markup, since by now focus is already on
    // the menu's first item.
    const opener = box.current?.querySelector<HTMLElement>("[aria-haspopup]") ?? box.current?.querySelector<HTMLElement>("button");
    const close = (event: MouseEvent | KeyboardEvent) => {
      const outside = event instanceof MouseEvent && !box.current?.contains(event.target as Node);
      const key = event instanceof KeyboardEvent ? event.key : "";
      if (!outside && key !== "Escape" && key !== "Tab") return;
      if (key === "Tab" && !box.current?.contains(document.activeElement)) return;
      if (key) event.preventDefault();
      setOpen(false);
      if (key) opener?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, box };
}

/** Moves focus among a menu's items, passing over disabled ones. */
function menuKeys(event: ReactKeyboardEvent<HTMLElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")].filter((item) => !item.hasAttribute("disabled"));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[next].focus();
}

export function Popover({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="menu" aria-label={label} className={`popover ${className}`} onKeyDown={menuKeys}>
      {children}
    </div>
  );
}
