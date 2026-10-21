// The window's own size, kept in state so a layout that caps itself to a
// share of it, such as the inspector's width or the console's height,
// adjusts when the window is resized rather than only on its next
// unrelated re-render. A frame is coalesced the way the cursor tracker in
// app.ts debounces its own updates, so a drag-resize does not re-render
// on every pixel.

import { useEffect, useState } from "react";

function size() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useViewportSize(): { width: number; height: number } {
  const [value, setValue] = useState(size);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setValue(size()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return value;
}
