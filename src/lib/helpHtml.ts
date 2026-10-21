// R's HTML help, rebuilt from an allowlist before it is shown. The page is
// parsed into an inert document, where nothing runs, and only plain
// structural tags and a few harmless attributes are copied across. Scripts,
// styles, frames, forms, images, event handlers, and links to the network
// never reach the app. Links between help pages are kept as references the
// Help pane follows itself.

const TAGS = new Set([
  "a", "abbr", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "dd", "dfn", "div", "dl", "dt", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "kbd", "li", "ol", "p", "pre", "q", "s", "samp", "small", "span",
  "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var",
]);

// Content that is dropped along with everything inside it.
const DROPPED = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "img", "svg", "math", "link", "meta", "title", "head", "noscript", "template", "video", "audio", "canvas"]);

const ATTRIBUTES = new Set(["colspan", "rowspan", "scope"]);

/** A link to another help page: its package, and either a file or a topic. */
export type HelpLink = { package: string; file: string; topic: string };

/** Reads a help link as R writes it, ../../stats/html/sd.html for a file or
 * ../../stats/help/var.html for a topic. Anything else is not followed. */
export function parseHelpLink(href: string): HelpLink | null {
  const match = /^(?:\.\.\/\.\.\/)?([A-Za-z][A-Za-z0-9.]*)\/(html|help)\/([^/#?]+)\.html(?:#.*)?$/.exec(href);
  if (!match) return null;
  return { package: match[1], file: match[2] === "html" ? decodeURIComponent(match[3]) : "", topic: match[2] === "help" ? decodeURIComponent(match[3]) : "" };
}

/** Copies one node and its children across, keeping only what is allowed. */
function copy(node: Node, target: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return target.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED.has(tag)) return null;
  // Unknown wrappers, such as html and body, give up their children. A
  // link the pane cannot follow, such as one to a package index or a web
  // page, becomes plain text rather than a link that does nothing.
  const kept = TAGS.has(tag);
  const followable = tag !== "a" || parseHelpLink(element.getAttribute("href") ?? "") !== null;
  const name = tag === "center" ? "div" : followable ? tag : "span";
  const out: Node = kept ? target.createElement(name) : target.createDocumentFragment();
  if (kept) {
    for (const attribute of Array.from(element.attributes)) {
      if (ATTRIBUTES.has(attribute.name)) (out as Element).setAttribute(attribute.name, attribute.value);
    }
    if (tag === "a" && followable) {
      const link = parseHelpLink(element.getAttribute("href") ?? "");
      if (link) {
        (out as Element).setAttribute("href", "#");
        (out as Element).setAttribute("data-package", link.package);
        (out as Element).setAttribute("data-file", link.file);
        (out as Element).setAttribute("data-topic", link.topic);
      }
    }
  }
  for (const child of Array.from(element.childNodes)) {
    const copied = copy(child, target);
    if (copied) out.appendChild(copied);
  }
  return out;
}

/** Turns R's help HTML into safe nodes for the Help pane. */
export function cleanHelp(html: string, target: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = target.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    const copied = copy(child, target);
    if (copied) fragment.appendChild(copied);
  }
  return fragment;
}
