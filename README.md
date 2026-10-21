# R: What Is It Good For?

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgray)](#requirements)
![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-arm64-black?logo=apple&logoColor=white)
![Intel](https://img.shields.io/badge/Intel-x86__64-black?logo=apple&logoColor=white)
[![Release](https://img.shields.io/github/v/release/drabhikroy/goodR)](https://github.com/drabhikroy/goodR/releases)

R: What Is It Good For? is a desktop workspace for R. It puts every result
right beside the code that made it, explains errors in plain words and
marks the exact spot that went wrong, and keeps the window quiet until you
ask for more. It is
written for people who are new to R as much as for people who use it every
day, and it is built for the Mac first, with Windows and Linux to follow.

Absolutely everything, as the opening screen says. Clean your data, run the
analysis, write the report, and build the Shiny app in one place.

![The opening screen in dark mode. The app icon, a white R and two orange
dots on a dark blue tile, sits above the name and the tagline. Below are a
large New project button, smaller buttons to open a project, start a
script, or open one, and a line confirming that R is ready. On the right
are recent projects and recent scripts grouped by
day.](docs/images/opening-dark.png)

Your code and data stay on your computer. The app has no accounts and no
telemetry. It reaches the network only when R itself does, such as when
you install a package from CRAN, and, if you set up the optional assistant,
to download Ollama and the models you choose.

## What it does

- **Each result under its code.** Run a line, a selection, or a whole file.
  A statement that prints something has its code lightly tinted and its
  result in a well right below, joined by one rule down the left. Tables,
  printed values, messages, and plots all land in place. Run Again, Copy,
  and Hide appear when you point at a result or tab into it. Statements
  that print nothing, such as an assignment, stay plain code with a small
  check in the gutter. A line that adds to a plot, such as `abline()` or
  `legend()`, redraws that plot in place
- **Cards, or plain text.** The tinted code and result wells are the
  default look. If you prefer a more traditional page, Plain text in
  Settings prints each result straight under its code with nothing around
  it, and In the console sends results to the console as R itself does
- **Copy as much as you select.** Drag or press Select All across any
  number of lines and results, and the copy holds the code and each result
  in order, as it would read in a console. Settings can limit copies to the
  code alone
- **Four familiar areas, on a calm workbench.** The script sits above the
  console, Environment and History are at the top right, and Plots, Help,
  and Packages at the bottom right, each a rounded panel with room around
  it and one toolbar across the top. Every edge can be dragged, and
  RStudio's shortcuts work, from Control and a number to move between
  panes to Shift Command M for a pipe
- **Text you can read, set your way.** The interface text is larger by
  default and scales from 90 to 150 percent. Code has its own settings:
  six typefaces, each shown in a live sample, a size from 11 to 24 points,
  three line spacings, and joined symbols for typefaces that have them.
  Line numbers, the current line band, wrapping, closing brackets,
  brackets colored by depth, and indent width are each one switch
- **Completion and help from R.** Names, a function's arguments, and a data
  frame's columns complete in the script and the console, from the engine
  R ships for its own console. Typing ?mean, searching the Help pane, or
  pressing F1 shows R's own help page, with links between pages
- **Import data with the code in view.** Choose a CSV, Excel, SPSS, Stata,
  SAS, R, Parquet, Feather, or JSON file, see its first rows as R reads
  them, adjust how it is read, and see the exact code before it runs. The
  separator and decimal mark of a text file are guessed for you, and the
  code can go straight into your script
- **Four places for results.** Under each line, beside the code in a
  column of its own, below the code, or in the console. Choose from the
  Results menu, the View menu, or Settings
- **Reports rendered beside the code.** A Quarto (.qmd) or R Markdown
  (.Rmd) file gets a Render button. The report renders in its own fresh R,
  so it shows exactly what its code makes from a clean start, and the
  console stays free. Progress shows chunk by chunk, and the finished HTML
  or PDF appears in the Report pane beside the code, ready to read while
  you edit. Render as HTML, Word, or PDF from the arrow beside the button.
  PDF is made with Typst, which comes with Quarto, so no LaTeX install is
  needed. When a chunk fails, the report says why in the same plain words
  as the console and underlines the failing line in your script
- **Results as you type.** An optional mode that reruns the statement you
  are editing after a short pause. Anything that writes files, installs
  packages, or changes the session is left alone until you run it yourself
- **Plain language errors, at the exact spot.** When a statement fails, the
  result says what happened in a headline, explains why in everyday words,
  and gives one thing to try. It shows the failing line with the part that
  went wrong marked by carets, underlines the same part in your script, and
  Go to the Spot selects it. A misspelled name gets a one click fix with the
  name you probably meant. Console errors get the same treatment. R's own
  message is one click away
- **An optional assistant on your own computer.** Set it up in three
  steps: use the Ollama already on your Mac or a private copy kept inside
  the app, let the app check your Mac's memory and disk if you wish, and
  choose a model from a short list that says what each is good and weaker
  at. It explains errors and code in plain words, adds comments, suggests a
  clearer version, and writes R from a description. Its code goes into your
  script only when you press Insert or Replace, after R's parser has
  checked that it can read it. Nothing leaves your computer
- **Projects.** Start a project from a template, an analysis, a Quarto
  report, or a Shiny app, or turn a folder you already have into one. Git
  history and renv package records are a checkbox each. Projects use the
  standard `.Rproj` file, so they also open in RStudio. A sidebar lists the
  project's scripts and its data files
- **Scripts on their own.** Outside a project, open R scripts, R Markdown,
  and Quarto files one at a time from the Open dialog, from Finder, by
  dropping them on the window, or from the recent list. R follows the
  script into its folder, so `"data.csv"` means the file beside it, and the
  console says each time R moves
- **Data you can see.** Choose a data frame in the Environment pane and it opens
  in a tab. Every column header shows its type, a small chart of its
  values, its range or most common value, and how many values are missing.
  Choose a column for its details, sort by it, or plot it in one click.
  Rows load a hundred at a time, so large data stays quick
- **Packages and history.** The Packages pane lists what is installed and
  attaches a package with a checkbox. The History pane lists what was typed
  in the console and sends any of it back to the console or into the script
- **Plots exported properly.** Export a plot for a slide, a document, or a
  journal's one or two column width, as PNG, PDF, or SVG. R draws the plot
  again at that size, so text stays in proportion and a PDF stays sharp at
  any zoom
- **R ready when you are.** R starts with the app, before anything is
  opened, and if the window reloads, the app reconnects to the R already
  running, so your objects and unsaved edits are kept. The console is a
  drawer you can drag taller or shorter, and its typing box has its own
  edge to make it as tall as you need. It keeps history, continues
  incomplete statements, and answers `readline()` prompts
- **Plots and objects at a glance.** The Plots pane shows the latest plot,
  rendered at the size of the pane, with earlier plots a click away. The
  Environment pane describes objects in words, such as "data frame, 344
  rows, 8 columns" or "linear model, R squared 0.76"
- **Packages found as you type.** The app reads `library()`, `require()`,
  and `pkg::` calls, checks which packages are missing, and offers to
  install them. You can have it ask every time or install automatically
- **Menus that grow with you.** Essentials shows what a new R user needs.
  Everything adds advanced tools such as Run to Here and Restart and Run
  All. A command palette finds any command by name
- **Every R on the machine.** The app looks in the standard install folders
  for every R version, lists the newest first, and lets you switch

![The workspace in dark mode with a project open. The script, the console,
and the two right hand areas are rounded panels on a darker backdrop, with
one toolbar across the top. The sidebar on the left lists the project's
scripts and data. In the editor, lines that printed
something are lightly tinted, with the result in a well below them: a
table, then a bar chart shown small with a link to the Plots pane. The last
line failed, and its result says in a headline that the package gt is not
installed yet, explains what a package is, and offers Install gt. On the
right, Environment lists three objects as plain rows, and the Plots pane
below shows the bar chart.](docs/images/workspace-dark.png)

![The Code text section of Settings. A sample of R at the top shows the
chosen typeface, JetBrains Mono, at 17 points. Below are six typefaces,
each named in its own letters, a size slider, three line spacings, and an
option to join symbols such as the assignment arrow into single
shapes.](docs/images/settings-code.png)

![A Quarto report in dark mode. The script, report.qmd, is in the editor,
and the Report pane at the bottom right shows the rendered page beside it:
the title, a heading, and the chunk's code with its output. Above the
preview are the file name, the time the render took, Open in browser, and a
button to show the file in Finder. Render and the arrow for other formats
sit in the toolbar beside Run line.](docs/images/report-dark.png)

![The Import Data dialog. A semicolon separated survey file is chosen. The
options on the left show the guessed separator, semicolon, and decimal
mark, comma. The preview on the right shows three typed columns, and below
it is the line of R that will run.](docs/images/import-data.png)

![The data viewer. Each column header shows a type badge, a small bar
chart of the column's values, its range, and its missing count. The
selected column, species, has its details beside the table: its most
common values as bars, its missing count, a Plot this column button, and
sort buttons.](docs/images/data-viewer.png)

## What it does not do

- It is not a fork of RStudio or Positron and does not read their settings
- It does not run code on a server. R runs on your computer
- It does not read data files itself. It lists them by name, and R reads
  them when you run the code that loads them
- It does not open files outside the scripts you choose and the scripts in
  a project you open
- It does not collect usage data, crash reports, or anything else
- It does not install R. It finds the R you have and points you to CRAN when
  there is none
- It does not change your files on its own. Saving, installing, and
  running are always your choice

## Planned

These are designed and will arrive in later releases, in roughly this order.

- Running Shiny apps in the workspace, and packaging a Shiny app so it can
  be shared and run on another computer without setup
- A Git panel for history, committing, and pushing
- Background jobs, with progress, for long scripts
- Results in a separate window, for a second display
- A first run walkthrough
- Windows and Linux releases. The code already builds and runs on Linux,
  where the tests below run on every change

## Requirements

- macOS 12 Monterey or later, on Apple Silicon or Intel
- R 4.2 or later, from [CRAN](https://cran.r-project.org/) or Homebrew. R
  4.2 is the oldest version ark supports, and the app names an older R and
  declines to start it rather than failing partway through

Nothing else is needed to write and run R. The R kernel, ark, ships inside
the app.

Rendering reports needs two more things, and the app says which is missing
when you first render:

- The rmarkdown and knitr packages in your R, installed with one button
  when the app finds them missing
- [Quarto](https://quarto.org/docs/get-started/), for Quarto documents and
  for PDFs. R Markdown documents render to HTML and Word without it, as
  long as Pandoc is installed, and Quarto brings its own Pandoc

## Install

The first public release is being prepared. Until it is published, run the
app from source as described under [Running from source](#running-from-source).

Once it is published:

1. Download [Good-For.dmg](https://github.com/drabhikroy/goodR/releases/latest/download/Good-For.dmg).
   One universal disk image runs on both Apple Silicon and Intel Macs.
2. Open the downloaded `.dmg`.
3. Drag Good For to the **Applications** folder.
4. Open Good For from **Applications**.

Each release lists a SHA256 checksum beside the disk image. To compare it
with your download:

```bash
shasum -a 256 ~/Downloads/Good-For.dmg
```

## Using R: What Is It Good For?

R starts with the app. The opening screen offers a new project first, then
opening a project, starting a script, or opening one, beside the projects
and scripts you used recently. You can also open scripts by dropping them
on the window or by choosing Open With in Finder, where the app is listed
for R, R Markdown, and Quarto files without taking over as their default.

| To | Press |
| --- | --- |
| Start a new project | ⇧⌘N |
| Open a project | ⇧⌘O |
| Open a script | ⌘O |
| Start a new script | ⌘N |
| Save, or Save As | ⌘S, ⇧⌘S |
| Run the line or selection | ⌘↩ |
| Run the whole file | ⇧⌘↩ |
| Render the report | ⇧⌘K |
| Stop | ⌘. |
| Restart R | ⇧⌘0 |
| Export the plot on show | ⇧⌘E |
| Explain the code at the cursor with the assistant | ⌥⌘E |
| Show the assistant | ⌃9 |
| Insert a pipe, an assignment, or a section | ⇧⌘M, ⌥−, ⇧⌘R |
| R help for the name at the cursor | F1 |
| Show help, history, plots, packages, or the environment | ⌃3, ⌃4, ⌃6, ⌃7, ⌃8 |
| Search for any command | ⌘K |
| Show results under each line, beside, below, or in the console | ⌥⌘1, ⌥⌘2, ⌥⌘3, ⌥⌘4 |
| Update results as you type, on or off | ⌥⌘L |
| Show or hide the project sidebar | ⌃⌘S |
| Show or hide the console history | ⇧⌘Y |
| Move to the editor or console | ⌃1, ⌃2 |

On Windows and Linux, Ctrl takes the place of ⌘ and Alt the place of ⌥, and
the app shows them that way. The sidebar shortcut there is Ctrl B.

With a project open, R works in the project folder. Opening a project
closes the scripts from other work that have no unsaved changes, and keeps
any that do. Drag the top edge of the console, or focus it and press the
up and down arrow keys, to change its height.

The R button in the title bar shows the working folder and holds Restart R
and Choose R Version. Settings is grouped into Appearance, Code text,
Editor, Results, Accessibility, R and packages, and Menus. Every change
applies at once, so there is nothing to save. Typing three characters of a name, or pressing
Tab, shows completions from R; Tab or Return takes the highlighted one.

## Your data

The app reads and writes only scripts: R, R Markdown, and Quarto files. A
script becomes available to it when you choose it in the Open or Save
dialog, drop it on the window, open it from Finder, or reopen it from the
recent list. Opening a project adds the scripts inside that project's
folder, and nothing else. Data files, whether listed in a project or
chosen in Import Data, are never opened by the app. R reads them: for the
preview, and when the import code runs. Help pages are R's own, rebuilt
from an allowlist of plain tags so they cannot run code or reach the
network.

The list of what may be opened is kept by the app's own code, which the
interface cannot add to, so a file you never chose stays out of reach.
Dialogs for opening, saving, and choosing a project folder run in that same
code rather than in the interface.

Settings, the recent scripts and projects, and what to reopen at launch are
kept in one file,
`~/Library/Application Support/app.goodfor.ide/settings.json` on the Mac. A
damaged settings file is set aside under a new name rather than deleted.

The data viewer asks R for one page of rows at a time and keeps nothing
after the tab closes. Exporting a plot runs the code that drew it in a
scratch environment, so nothing it assigns reaches your workspace, and puts
the random number state back afterward.

R itself can read and write anywhere your user account can, exactly as it
does in a terminal or in any other R environment. The app does not limit
what your code does.

## The assistant

The assistant is optional and stays off until you set it up from its tab
beside Environment and History. It runs through
[Ollama](https://ollama.com), a free program that runs language models on
your computer.

1. **Ollama.** Use the Ollama already on your Mac, or install a private
   copy inside the app. The private copy is Ollama 0.40.3, a 167 MB
   download checked against Ollama's published SHA-256 before it is
   unpacked. It lives in
   `~/Library/Application Support/app.goodfor.ide/assistant`, runs only
   while the app is open, on a port of its own, and is removed with its
   models from the same screen.
2. **This Mac.** If you agree, the app reads your Mac's memory, free disk
   space, and chip, to mark which models fit. You can skip this step.
   Nothing is saved or sent.
3. **Models.** A short list of free models, each with what it is good and
   weaker at for help with R, how much it downloads, and whether it fits
   your Mac. The suggestion is the largest code model that fits well.
   Models you already downloaded with Ollama are found and can be used.
   Add, remove, and switch models at any time.

![The assistant's third setup step, Models. Six model cards are listed,
each with its size, a note on how well it fits this Mac, and what it is
good and weaker at. One is marked Suggested for this Mac, and the largest
is marked too large for this Mac's memory.](docs/images/assistant-setup.png)

![The workspace with the Assistant tab open. Under a line that failed
because the package gt is not installed, the result offers Ask the
assistant. The assistant's answer, on the right, explains the problem in
two sentences and suggests install.packages("gt"), with a note that R can
read the code and a button to put it in the
console.](docs/images/assistant-dark.png)

What the assistant sees: the code you ask about, R's error message, the R
version, and the names of the objects in your session, with column names
for tables. It never sees the values in your data. What it writes is a
suggestion. Code goes into your script only when you press Insert or
Replace, R's parser checks it first without running it, and Undo takes it
back out. Replace appears only when the suggestion is a reworked version of
the code you asked about, never for a different step that would wipe it
out. A suggestion that only installs packages offers Put in the Console
instead, since an install is done once and does not belong in the script.

## Accessibility

- Five color vision palettes, standard, deuteranopia, protanopia,
  tritanopia, and monochrome, each in light and dark. An automated audit
  runs 670 checks of WCAG 2.2 AA contrast, and confirms that
  states such as warning and error stay distinguishable under simulated
  color vision deficiency. Plots follow the chosen palette
- Meaning never depends on color alone. Each state also carries its own
  icon shape and words, such as a triangle and "did not run"
- Appearance follows the system or can be set to light or dark
- Text size from 90 to 150 percent, scaling the whole interface, controls
  included, with code sized on its own from 11 to 24 points
- Every pointer target is at least 44 pixels tall, checked by a test on
  each screen
- Animation stops when the system asks for reduced motion, or when you turn
  on Reduce motion in Settings
- Visible focus on every control, focus kept inside open dialogs and
  returned when they close, menus that move with the arrow keys and close
  with Escape, and full keyboard use through shortcuts and the command
  palette
- Controls are labeled in words rather than icons alone, and every menu
  item shows its keyboard shortcut
- Run results and status changes are announced through live regions
  without moving focus, including what went wrong when a line fails. A
  streaming assistant answer is announced once, when it is finished, rather
  than word by word. Controls carry names and roles for screen readers,
  and every screen passes automated WCAG 2.2 A and AA checks with axe in
  both appearances

Automated checks catch a great deal but not everything. Reports from people
using VoiceOver or other assistive technology are especially welcome.

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
objects, size plots to the pane, set the plot palette, check for missing
packages, page through data frames for the viewer, and export plots. They never appear among your objects or mask a name you define.

Plots are rendered by R at the exact pixel size of the pane they appear in,
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

The assistant lives in its own crate, `crates/assistant`. It finds Ollama,
downloads and checks the private copy with the macOS tools `curl` and
`tar`, lists and downloads models, and streams answers over Ollama's local
HTTP interface on the loopback address, bypassing any proxy so requests
cannot leave the machine.

## For developers

### Project layout

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
                     stopping it, and reading why it failed.
  tests/             Renders real reports with Quarto and R.
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
  images/           Screenshots and icon variants for this README.
```

### Dependencies

Tauri provides the desktop shell, and React and CodeMirror the interface.
DM Sans and DM Mono are bundled from Fontsource, so nothing is fetched from
the network at run time. The Rust side uses the pure Rust `zeromq` crate, so
building needs no system ZeroMQ library.

ark is not committed to the repository. `scripts/fetch-ark.mjs` downloads
the pinned release from Posit and checks its SHA256 against values recorded
in the script before anything uses it.

### Running from source

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

### Tests and standards gates

```bash
npm run verify
npm run test:ui
```

`npm run verify` runs, in order, the writing standards gate, the color
contrast audit, a type checked build, the unit tests, and the Rust tests.
The Rust integration tests start a real R through ark and check values,
plots, plot updates from lines such as `abline()`, errors, parse positions,
the data viewer's pages, plot export at exact sizes, interrupting a long
run, answering a `readline()` prompt, and recovering from a crash. The
assistant's tests check the fit rules, the prompts, reading streamed
answers and download progress from a stand-in server, and installing the
private copy from a checked archive, including refusing one whose checksum
differs. They fail rather than skip when R or ark is
missing. The render tests render real Quarto and R Markdown documents to
HTML, Word, and PDF, check that a failing chunk is named with its lines,
and stop a long render and confirm its R is gone. They need Quarto and the
rmarkdown and knitr packages, and say so and pass without rendering on a
machine that lacks them. The continuous integration machines have all
three.

`npm run test:ui` runs the interface tests in Chromium, including axe
accessibility checks in both appearances and the 44 pixel target check on
every screen, every Settings section, and every state of the Report
pane. The preference tests check that
the code typeface, size, and spacing reach the editor, that editor
switches take effect, that plain and console results work, and that a
copy across several results holds them all.

The standards gate rejects em and en dashes, contractions, a banned list of
words, and British spellings in every source and document file, and holds
logic files to a 15 percent comment floor. A line can opt out by carrying a
comment that begins `standards:` and says why.

### Building distributable packages

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

### Code signing and verification

The Mac app is signed with a Developer ID Application certificate, uses the
hardened runtime, and is notarized by Apple. ark is signed with the same
certificate and the entitlements in `src-tauri/entitlements.plist`, which
allow it to load libR and package libraries signed by the R Foundation and
other developers.

Releases are built on GitHub Actions by
`.github/workflows/release-macos.yml`, which runs when a version tag is
pushed or by hand with `gh workflow run release-macos.yml`. It signs and
notarizes the app, confirms ark carries its entitlement, runs the R
integration tests against the signed ark, notarizes and staples the disk
image, and attaches it to a draft release. The certificate and Apple
credentials are repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.

To confirm an installed copy is signed and notarized:

```bash
codesign --verify --deep --strict --verbose=4 "/Applications/Good For.app"
spctl --assess --type execute --verbose=4 "/Applications/Good For.app"
```

The second command should report `accepted` and `source=Notarized Developer
ID`.

## Contributing

The reasoning behind the interface, with the research each decision rests
on, is in [docs/DESIGN.md](docs/DESIGN.md). See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the code is organized and what
the checks expect, [SECURITY.md](SECURITY.md) for how to report a
security problem, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Credits and background

The name comes from the question people new to R often ask, with a nod to
the song. The answer on the opening screen is the point of the app.

R runs through [ark](https://github.com/posit-dev/ark) by Posit Software,
PBC, used under the MIT License. Its license and notice ship inside the app.
The interface is set in DM Sans and DM Mono, used under the SIL Open Font
License.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md). The full text is also at
<https://polyformproject.org/licenses/noncommercial/1.0.0>.

Personal use, personal study, hobby projects, teaching, academic research, and
use by charitable, educational, nonprofit, public research, public health, and
government organizations are permitted. Commercial use is not permitted without
a separate license.

Required notice: © 2026 Abhik Roy.

DM Sans and DM Mono are used under the SIL Open Font License. ark is used
under the MIT License.
