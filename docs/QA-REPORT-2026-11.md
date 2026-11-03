# Quality assessment of goodR 1.0.0

November 2026. A testing, security, and quality review of release 1.0.0
(commit `532ec03`), with the fixes it led to, released as 1.0.1.

## Summary

goodR 1.0.0 is in good condition. Its core promises held up under tests
built to break them: file access stays limited to the scripts you choose,
nothing passed to R can escape its string, help pages cannot run code, and
the statement splitter that decides what Run Line sends now agrees with R's
own parser on 2,944 of 2,946 real R files (89,438 statements), and the two
others differ only for reasons the editor already handles.

The review found thirteen problems and fixed all thirteen. Four mattered most:

- The Open Posit Community and Open Stack Overflow buttons in Ask for help
  online never worked, because the window's link allowlist left both sites
  out. Confirmed in the running app.
- A chunk whose options held a closing brace, as in a LaTeX label in a
  figure caption, was not recognized, so its code never ran. Nothing said so.
- A Shiny app's R kept running, and kept its port, after goodR crashed or
  was forced to quit. Confirmed in the running app.
- PRIVACY.md did not mention that goodR keeps up to a hundred earlier
  versions of every saved script, and the last sixty results.

Four risks remain open and are described below, chief among them that the
private Ollama copy is likely to keep running after a crash.

Test execution status: **PASS** for the defined scope, with the limits
listed under Testing environment. Release readiness: **READY FOR
CONSIDERATION** once these fixes are merged and released, with the open
risks reviewed.

## Testing environment

- Source: `532ec03` (goodR 1.0.0), then the branch with fixes
- Linux 6.18, Ubuntu 24.04 container, two cores. Not tested on macOS,
  which is the primary platform; see Limitations
- R 4.3.3, ark 0.1.252 (checksum verified by the project's own script), knitr 1.45 and, for report failures, 1.52,
  Quarto 1.6.42, knitr, shiny, rmarkdown
- Node 22, Rust 1.97, Vitest 5, Playwright 1.56 with Chromium
- The real desktop app, built from source, driven on a virtual display

## What was tested

| Area | How | Result |
|---|---|---|
| Existing checks | Standards gate, color audit, build, all unit, Rust, and interface tests, before and after the fixes | All pass both times |
| Statement splitter | Compared with R's parser on 2,946 R files installed with packages | 2,944 agree; the 2 others use `#line` directives and old Mac line endings, which the editor normalizes. 2 real files exposed defect 7 |
| Document chunks | Compared with `knitr::purl()` on 651 R Markdown and Quarto documents | Exposed defects 2, 8, and 9. After fixes, the only differences are purl's own additions |
| Quoting for R | 4,012 generated strings with quotes, backslashes, control characters, and Unicode, quoted and read back by R's parser | Every one came back byte for byte |
| Help pages | 23 hostile pages (scripts, event handlers, SVG and MathML tricks, `javascript:` links) cleaned in a real browser and put in the live page | Nothing ran; only allowlisted tags and attributes were left |
| File access | Code review of every command, plus the existing Rust tests | Sound: resolved paths, no prefix tricks, links cannot redirect a save |
| Preview server | Parent steps, encoded steps, planted links, wrong Host headers | Sound after defect 6 |
| Links the window opens | A new test reads every address the interface opens and checks it against the allowlist | Exposed defect 1 |
| Real app with real R | Launch, run lines, plain error explanations, closest name suggestion, Quarto render, Shiny app, Open in browser, Ask for help online, restart with session and kept results restored, normal quit, forced quit | All worked except defects 1 and 3, both since fixed and checked again in the app |
| Dependencies | `npm audit`, pinned actions, checksummed downloads, secret scan | No known vulnerabilities, no committed secrets |
| The tests themselves | 28 deliberate mistakes planted in critical code, one at a time | 25 caught after new tests; the other 3 are behind a second layer of defense and change nothing |

## Defects found and fixed

| # | Severity | Problem | Fix | Checked by |
|---|---|---|---|---|
| 1 | Medium | Open Posit Community and Open Stack Overflow showed "The browser did not open" every time | Added both exact addresses to the allowlist and to SECURITY.md | New Rust test; real app before and after |
| 2 | Medium | A chunk whose options held a `}`, such as `fig.cap='\label{fig:a}'`, was treated as prose, so Run chunk and Run document skipped its code without a word | The header now reads options to the last brace on the line, as knitr does | New unit test; knitr comparison |
| 3 | Medium | After a crash or forced quit, a running Shiny app's R kept running the app and holding its port | The app's R checks every two seconds that goodR is still there and quits when it is not (Unix only, since R's check would end the process on Windows) | New integration test; real app before and after |
| 4 | Medium | PRIVACY.md left out the saved versions of each script and the kept results | Added both, with where they live and how to clear them | Labels checked against the interface |
| 5 | Low | The App pane accepted any loopback address the app printed, so a printed line about another local program could put it in the pane | Only the port given to the app counts | New unit test; real app still shows apps |
| 6 | Low | The preview server for shared apps answered any Host, which leaves room for DNS rebinding from a web page | It answers only `127.0.0.1` or `localhost` at its own port | New test |
| 7 | Low | A page break or a wide Unicode space on its own line became a "statement" | The splitter skips exactly the characters R skips | New unit tests; R comparison |
| 8 | Low | A chunk written `{r, engine = "cpp11"}` was run as R | The engine option is followed | New unit test |
| 9 | Low | In older documents where a chunk ends at the next header, the header line was sent to R | A chunk ends at the next header with as many backticks, as in knitr | New unit test |
| 10 | Low | A second damaged settings file overwrote the first set aside copy, and bytes that were not text were not set aside at all | Each damaged copy gets a name of its own | New unit test |
| 11 | Trivial | The opening screen said "Seven scripts and documents"; there are eight, plus four apps | Corrected | Read from the shipped list |
| 12 | Low | The CI token was not limited to reading | `permissions: contents: read` | Review |
| 13 | Medium | With knitr 1.46 and later, a failing report showed R's message but not the line that failed, because knitr changed how it names the failing chunk and now prints the message first | Both of knitr's formats are read, and the newer range, which starts at the chunk header, is counted from the line after it | Found by the render tests on a Mac with knitr 1.52; reproduced and fixed against knitr 1.52 and 1.45 |

Also added: a test that Replace never overwrites lines changed since the
question, a promise SECURITY.md made with no test behind it, and tests for
gaps the planted mistakes exposed.

## Risks that remain open

These need a decision or a Mac, so they were documented rather than changed.

1. **The private Ollama copy is likely to outlive a crash.** It is stopped
   only when goodR exits normally. After a crash or a forced quit it may
   keep running, with a model in memory, which PRIVACY.md says does not
   happen. Found by reading the code; Ollama could not be run here. One
   remedy: at launch, stop a private copy that is already answering on its
   port, since goodR did not start it.
2. **Misspelled function names get no suggested fix.** `mena()` is
   explained, but only object and column names get "the closest match is".
   FEATURES.md reads as if every misspelled name does. Either narrow the
   wording or suggest from the functions R can see.
3. **A running Shiny app is open to DNS rebinding.** R's own web server
   serves it and does not check the Host. A web page in your browser could,
   with effort, reach the app while it runs. This is how Shiny works
   everywhere, and it is outside goodR's code.
4. **Run document runs chunks marked `eval=FALSE`.** Knitting skips them.
   Decide whether this is intended.

Lower: after a render, the preview may load any file under the report's
folder for the rest of the session, which is wide when a report sits in
the home folder (the report frame itself cannot read files back, so this is
defense in depth); and the example scripts say Command Return, which needs
changing before the Windows and Linux releases.

## Limitations

- Everything ran on Linux. macOS behavior (WebKit, the Mac menus, signing,
  the Finder) was not tested here, and the forced quit result rests on the
  shared Unix behavior.
- The assistant, Ollama, the updater, and LaTeX installs were reviewed in
  code only.
- The interface tests use the project's stand-in for R; real R was covered
  by the Rust tests and by driving the app by hand.
- No usability testing with real users.

## Closing reviews

1. **Requirements and correctness.** Rechecked every fix against its
   promise. Found that the new chunk reader dropped a label written in
   quotes, which knitr accepts. Fixed to match knitr's own reading, with a
   test.
2. **Security and failure.** Rechecked each fix for bypasses: the
   allowlist entries match only their exact addresses, the Host check
   passes the pane's own requests, and the parent check cannot fire while
   goodR runs and is off on Windows, where it would do harm. The open risks
   above came from this pass.
3. **Regression and evidence.** Reviewed the whole diff, confirmed that
   files changed during mutation testing were restored exactly, and ran
   every check again on the final code. The standards gate and the color
   audit (2,049 checks) passed, as did the build, 171 unit tests (161
   before), and 105 Rust tests (98 before), with no failures, skips, or
   compiler warnings. In the interface tests, 157 of 158 passed (156
   before). The one failure was an accessibility audit that ran out of
   time, not one that found a problem. On this two core machine that test
   takes 26 to 28 seconds against a 30 second limit, and it failed 2 times
   in 9 when repeated, always on time. It now has more time, with its
   checks unchanged, and passes.
