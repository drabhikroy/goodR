# Developing goodR

This guide is for people who want to build the app from source, change it, or understand how it works inside. If you only want to use the app, the [README](../README.md) is the place to start.

## How it works

The app is built with [Tauri](https://tauri.app/). A small Rust core owns the
window, the files, and R. The interface is React and TypeScript shown by
the system's own web view, WebKit on the Mac, so the app stays small and
starts quickly. The editor is CodeMirror 6.

The Open and Save dialogs run in the Rust core rather than the interface,
so the paths they return are known to come from you. The core keeps the set
of files you chose, plus the open project's folder for scripts only, and
checks every read and write against it. A new project can only be created
in the folder you just chose in its dialog.

R runs in [ark](https://github.com/posit-dev/ark), the R kernel Posit wrote
for Positron, as a separate process. The Rust core speaks the Jupyter
protocol to it over ZeroMQ on loopback ports, with every message signed by a
key generated for that session. Each run carries an id chosen by the
interface before it is sent, so output can never arrive for a run the
interface does not yet know about. Runs are queued and go one at a time, so
output arrives in order and Run File stops at the first error, as sourcing
a script does.

A few helper functions written in base R are attached to the session as
`tools:goodfor`, the way RStudio attaches `tools:rstudio`. They describe
objects, size plots to the canvas, set the plot palette, check for missing
packages, page through data frames for the viewer, and export plots. They never appear among your objects or mask a name you define.

Plots are rendered by R at the width of the canvas they appear in,
at the display's pixel density, so they arrive sharp instead of being
scaled. ark sends a line that adds to a plot, such as `abline()`, as an
update to the plot already on screen, and the app redraws that plot in
place.

When a line will not parse, ark's message does not say where. The app asks
R's parser, through a helper that parses the code without running it,
which names the line and column, so the spot can be marked.

Reports render in `crates/render`. A Quarto document runs `quarto render`
and an R Markdown document runs `rmarkdown::render()` in a new Rscript,
both with the R chosen in the app, in the report's own folder. The program
starts in a process group of its own, so Stop ends it along with every R
it started. knitr's progress lines drive the progress bar, and when a chunk
fails, knitr's "Quitting from lines" note names the chunk, so the
interface can find the exact line within it. The preview loads the report
through Tauri's asset protocol, which is opened only for the folder of a
report the app has just rendered, inside a sandboxed frame.

Sharing an app runs `shinylive::export()` in a new Rscript, into a new
folder named after the app inside the folder chosen in the system dialog,
so it never writes into a folder that already holds something. A single
file app is copied alone into a folder of its own first, so nothing beside
it is bundled. The preview serves that folder from the Rust core on a
loopback port, with `.wasm` files served as WebAssembly, since browsers run
the page only from a web address. Only folders an export made in this
session can be served or shown in Finder.

Shiny apps run in the same crate, from its `shiny` module, which follows
the app's R the way a render is followed and stops it the same way. The
app runs `shiny::runApp()` in a new Rscript in the app's own folder, on a
loopback port the system picks as free, with Shiny's own reloading turned
on, so saving a file of the app reloads it. Shiny names its address a
moment before it answers there, so the pane waits until the port accepts
a connection before showing the app. Errors inside the running app reach
the pane as Shiny prints them, as warnings that leave the app running,
and a syntax error that stops it names the file, line, and column.

The assistant lives in its own crate, `crates/assistant`. It finds Ollama,
downloads and checks the private copy with the macOS tools `curl` and
`tar`, lists and downloads models, and streams answers over Ollama's local
HTTP interface on the loopback address, bypassing any proxy so requests
cannot leave the machine.

## Project layout

```text
crates/rsession/     Talks to R. Finds installations, starts ark, speaks
                     the Jupyter protocol. No interface code, so its
                     tests run against a real R without a window.
  tests/integration/ Tests against real R through the pinned ark.
crates/assistant/    The optional assistant: finding or installing
                     Ollama, the model list and fit check, reading the
                     Mac's specs, and the prompts for each kind of help.
crates/render/       Rendering reports: finding Quarto, choosing the
                     program for each format, following its progress,
                     stopping it, and reading why it failed. Running
                     Shiny apps the same way.
  tests/             Renders real reports with Quarto and R, and runs
                     real Shiny apps.
src-tauri/           The desktop app. Commands, menus, settings, project
                     templates, and file access limited to the scripts
                     you open.
src/                 The interface.
  components/        React components, one file per area of the window.
  lib/               The controller, editor setup, statement splitter,
                     package detection, and error explanations.
  theme/             Color tokens for every palette and appearance.
tests/unit/          Unit tests for the interface logic.
tests/ui/            Interface and accessibility tests in a browser.
scripts/             Downloading ark, the standards gate, and the color
                     audit.
design/icon/         The icon source and the script that builds every
                     size from it.
docs/               The design rationale, with its sources.
  images/           Screenshots, made by npm run screenshots, and icon variants.
```

## Dependencies

Tauri provides the desktop shell, and React and CodeMirror the interface.
DM Sans and DM Mono are bundled from Fontsource, so nothing is fetched from
the network at run time. The Rust side uses the pure Rust `zeromq` crate, so
building needs no system ZeroMQ library.

ark is not committed to the repository. `scripts/fetch-ark.mjs` downloads
the pinned release from Posit and checks its SHA256 against values recorded
in the script before anything uses it.

## Running from source

You need Node.js 22, Rust 1.90 or later, and R 4.2 or later.

```bash
npm install
node scripts/fetch-ark.mjs
npm start
```

`npm start` builds the Rust core once and opens the app. Changes to the
interface appear live. Changes to the Rust code need the app quit and
`npm start` run again; `npm run tauri dev` rebuilds them automatically
instead.

Keep the project out of folders that a sync service manages, such as
Documents or Desktop when iCloud Drive syncs them. A sync service touches
every file it uploads, and file watchers see each touch as an edit. The
interface ignores touches that leave a file unchanged, and `npm start`
does not watch the Rust code, but `npm run tauri dev` will rebuild and
restart the app for every touch. A folder such as `~/Developer` is not
synced.

`npm run dev` alone serves the interface in a browser with a stand-in for
R, which is handy for working on layout.

## Tests and standards gates

```bash
npm run verify
npm run test:ui
```

`npm run verify` runs the writing standards gate, the color contrast audit, a type-checked build, the unit tests, and the Rust tests, in that order.

The Rust integration tests start a real R through ark. They check values, plots, plot updates from lines such as `abline()`, errors, parse positions, the data viewer's pages, plot export at exact sizes, interrupting a long run, answering a `readline()` prompt, and recovering from a crash. If R or ark is missing, they fail instead of skipping.

The assistant's tests use a stand-in server. They check the fit rules, the prompts, reading streamed answers and download progress, and installing the private copy from a checked archive, including refusing one whose checksum does not match.

The Shiny tests run real apps, both from an app.R folder and from a single script. They check that saving reloads the app, that Stop frees its port, and that a syntax error is reported with its file and line. Another test exports a real app with shinylive and serves the page, which needs the shinylive package and an internet connection. The preview server's own tests check content types and that requests cannot reach outside the exported folder.

The render tests render real Quarto and R Markdown documents to HTML, Word, and PDF. They check that a failing chunk is reported with its lines, and that stopping a long render also ends its R.

Tests that need a package or program, such as Quarto, shiny, or shinylive, say so and pass without running when it is missing. The continuous integration machines have all of them.

`npm run screenshots` remakes every screenshot in the README and in
`docs/FEATURES.md`, in light and dark, from the same browser build the
interface tests use. Run it after a change to how the app looks.

`npm run test:ui` runs the interface tests in Chromium, including axe
accessibility checks in every appearance and the 44 pixel target check on
every screen, every Settings section, and every state of the Report
pane. The preference tests check that
the code typeface, size, and spacing reach the editor, that editor
switches take effect, that plain results and results in the canvas work,
and that a copy across several results under each line holds them all.

The standards gate rejects em and en dashes, contractions, a banned list of
words, and British spellings in every source and document file, and holds
logic files to a 10 percent comment floor. A line can opt out by carrying a
comment that begins `standards:` and says why.

## Building distributable packages

```bash
npx tauri build --target universal-apple-darwin --bundles app,dmg
```

This needs both Mac Rust targets and the universal ark:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
node scripts/fetch-ark.mjs universal-apple-darwin
```

Output is written to `target/universal-apple-darwin/release/bundle/`.

Build outside iCloud Drive. Folders that iCloud syncs, including
`~/Documents` and `~/Desktop` when Desktop and Documents syncing is on,
attach extended attributes that `codesign` refuses.

## Code signing and verification

The Mac app is signed with a Developer ID Application certificate, uses the
hardened runtime, and is notarized by Apple. ark is signed with the same
certificate and the entitlements in `src-tauri/entitlements.plist`, which
allow it to load libR and package libraries signed by the R Foundation and
other developers.

Releases are built on GitHub Actions by
`.github/workflows/release-macos.yml`, which runs by hand with
`gh workflow run release-macos.yml --ref v1.2.3`. It signs and
notarizes the app, confirms ark carries its entitlement, runs the R
integration tests against the signed ark, notarizes and staples the disk
image, and attaches it to a draft release. The certificate and Apple
credentials are repository secrets: `CSC_LINK` and `CSC_KEY_PASSWORD` for
the certificate, and `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER` for the App Store Connect API key that notarizes it. The
key is the `.p8` file made under Users and Access, then Integrations, in App
Store Connect. The certificate signs; the key only notarizes, so both are
needed.

To make the same signed disk image on a Mac instead, with the certificate in
the login keychain, save the API key as a notarization profile once, then
run the script:

```bash
xcrun notarytool store-credentials "goodR" \
  --key ~/private/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer ISSUER-ID
scripts/release-mac.sh
```

It runs the checks, then builds, signs, notarizes, and staples the app and
`goodR.dmg`, and writes `goodR.dmg.sha256` beside it.

Release notes live in `docs/release-notes`, one file per version tag. To
make the draft release from them:

```bash
gh release create v1.0.0 goodR.dmg goodR.dmg.sha256 --draft --title "goodR 1.0.0" --notes-file docs/release-notes/v1.0.0.md
```

Installed copies update themselves through Tauri's updater, which checks
each download against a public key built into the app. To turn this on,
make a key pair once and keep the private half safe:

```bash
npx tauri signer generate -w ~/.tauri/goodr.key
```

Add the private key, and its password if it has one, as the repository
secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the public key, the text in
`~/.tauri/goodr.key.pub`, as the repository variable
`GOODR_UPDATER_PUBKEY`. A release built with them carries
`goodR.app.tar.gz` and `latest.json`, which installed copies read once
the release is published. A build without them still works, and its
Updates page links to the release page instead.

To confirm an installed copy is signed and notarized:

```bash
codesign --verify --deep --strict --verbose=4 "/Applications/goodR.app"
spctl --assess --type execute --verbose=4 "/Applications/goodR.app"
```

The second command should report `accepted` and `source=Notarized Developer
ID`.
