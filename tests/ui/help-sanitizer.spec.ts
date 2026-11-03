import { expect, test } from "@playwright/test";

// Help pages come from installed packages, and anyone can publish a
// package, so SECURITY.md promises that a help page cannot run scripts,
// load styles, frames, or images, or reach the network. These pages are
// written to try. Each is cleaned in the browser by the same code the Help
// pane uses, put into the live page, and then checked: nothing may have run,
// and only plain tags with harmless attributes may be left.

const HOSTILE: string[] = [
  "<script>window.__ran = 'script'</script>",
  "<img src=x onerror=\"window.__ran = 'img'\">",
  "<svg onload=\"window.__ran = 'svg'\"></svg>",
  "<svg><script>window.__ran = 'svg script'</script></svg>",
  "<math><mtext><table><mglyph><style><img src=x onerror=\"window.__ran = 'math'\"></style></mglyph></table></mtext></math>",
  "<a href=\"javascript:window.__ran = 'link'\">click</a>",
  "<a href=\"../../stats/html/sd.html\" onclick=\"window.__ran = 'help link'\" style=\"color:red\">sd</a>",
  "<a href=\"../../stats/html/sd.html#x\" onmouseover=\"window.__ran = 'hover'\">sd</a>",
  "<p onclick=\"window.__ran = 'p'\" style=\"background:url(https://example.com/x)\" class=\"secret\" id=\"x\">text</p>",
  "<iframe src=\"https://example.com\"></iframe>",
  "<object data=\"https://example.com/x.swf\"></object><embed src=\"https://example.com\">",
  "<form action=\"https://example.com\"><input name=a><button formaction=\"javascript:window.__ran='form'\">go</button></form>",
  "<link rel=stylesheet href=\"https://example.com/x.css\"><style>body{background:url(https://example.com/y)}</style>",
  "<meta http-equiv=\"refresh\" content=\"0;url=https://example.com\">",
  "<!--><img src=x onerror=\"window.__ran = 'comment'\">-->",
  "<noscript><p title=\"</noscript><img src=x onerror=window.__ran='noscript'>\"></noscript>",
  "<template><img src=x onerror=\"window.__ran = 'template'\"></template>",
  "<table><td background=\"https://example.com/z\" onclick=\"window.__ran='td'\" colspan=\"2\">cell</td></table>",
  "<video src=x onerror=\"window.__ran = 'video'\"></video><audio src=x onerror=\"window.__ran = 'audio'\"></audio>",
  "<details open ontoggle=\"window.__ran = 'details'\">x</details>",
  "<x-custom onfocus=\"window.__ran = 'custom'\" autofocus tabindex=1>y</x-custom>",
  "<base href=\"https://example.com/\"><a href=\"../../stats/help/var.html\">var</a>",
  "<pre><code>a &lt;- 1 &lt;script&gt;not a tag&lt;/script&gt;</code></pre>",
];

test("help pages written to attack the app are left as plain text and tags", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async (pages) => {
    const { cleanHelp } = await import("/src/lib/helpHtml.ts");
    const host = document.createElement("div");
    document.body.append(host);
    const out: { input: string; html: string }[] = [];
    for (const input of pages) {
      host.replaceChildren(cleanHelp(input));
      // Fire the events an attacker would hope for.
      host.querySelectorAll("*").forEach((element) => {
        for (const kind of ["click", "mouseover", "focus", "toggle", "load", "error"]) element.dispatchEvent(new Event(kind));
      });
      out.push({ input, html: host.innerHTML });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { out, ran: (window as unknown as { __ran?: string }).__ran ?? null };
  }, HOSTILE);

  expect(results.ran, "a script in a help page ran").toBeNull();
  const allowedTags = /^(a|abbr|b|big|blockquote|br|caption|cite|code|dd|dfn|div|dl|dt|em|h[1-6]|hr|i|kbd|li|ol|p|pre|q|s|samp|small|span|strong|sub|sup|table|tbody|td|tfoot|th|thead|tr|tt|u|ul|var)$/;
  for (const { input, html } of results.out) {
    const tags = [...html.matchAll(/<([a-z0-9-]+)/gi)].map((match) => match[1].toLowerCase());
    for (const tag of tags) expect(tag, `${tag} kept from ${input}`).toMatch(allowedTags);
    const attributes = [...html.matchAll(/\s([a-z-]+)=/gi)].map((match) => match[1].toLowerCase());
    for (const name of attributes) expect(["href", "data-package", "data-file", "data-topic", "colspan", "rowspan", "scope"], `${name} kept from ${input}`).toContain(name);
    // A link may only point nowhere; the pane follows help links itself.
    for (const href of html.matchAll(/href="([^"]*)"/g)) expect(href[1]).toBe("#");
    expect(html).not.toMatch(/https?:|javascript:/i);
  }
  // A help link keeps what the pane needs to follow it, and nothing else.
  const link = results.out.find(({ input }) => input.includes("onclick=\"window.__ran = 'help link'\""))!;
  expect(link.html).toBe('<a href="#" data-package="stats" data-file="sd" data-topic="">sd</a>');
  // Text that only looks like a tag stays text.
  const code = results.out.find(({ input }) => input.startsWith("<pre>"))!;
  expect(code.html).toBe("<pre><code>a &lt;- 1 &lt;script&gt;not a tag&lt;/script&gt;</code></pre>");
});
