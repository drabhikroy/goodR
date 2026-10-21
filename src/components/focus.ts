// Keeps Tab inside a dialog: from the last control it goes to the first,
// and Shift Tab from the first goes to the last. Focus that has escaped,
// such as to the page behind, is brought back to the first control.

const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex='0']";

export function trapTab(container: HTMLElement, event: KeyboardEvent) {
  // Another trap above this one, such as a dialog over the tour, has
  // already handled the key.
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hasAttribute("disabled"));
  if (!focusable.length) return;
  const [head, tail] = [focusable[0], focusable[focusable.length - 1]];
  const inside = container.contains(document.activeElement);
  if (!inside || (event.shiftKey && document.activeElement === head)) {
    event.preventDefault();
    (event.shiftKey && inside ? tail : head).focus();
  } else if (!event.shiftKey && document.activeElement === tail) {
    event.preventDefault();
    head.focus();
  }
}
