# Security

## Reporting a problem

Report a security problem privately through the repository's Security tab
with **Report a vulnerability**, rather than in a public issue. Reports are
read by the maintainer, and a fix is released before the problem is
described publicly.

## What the app is exposed to

The interface runs in the system web view under a Content Security Policy
that allows no remote origin. Scripts, styles, and fonts load only from the
app itself, and the only connection the page may make is to the app's own
core. The window may ask the system for a short, fixed list of things:
confirmation and message boxes, setting its title, and opening a link in
the browser. Open and Save dialogs are not on that list; the core shows them
itself.
Links open only to this app's GitHub pages, to CRAN, to Ollama's
download page, and to Quarto's getting started page.

The interface cannot touch the file system directly. It asks the Rust
core, which reads and writes only files you chose: in an Open or
Save dialog that the core itself shows, by dropping them on the window, by
opening them from Finder, or from the recent list, which only the core can
add to. Opening a project, chosen by its `.Rproj` file in the same way,
adds the R, R Markdown, and Quarto scripts inside that project's folder and
nothing else. So does opening a script that sits inside a project: the
core lists the folders above the chosen script, stopping below the home
folder and the top of the disk, and opens the project whose `.Rproj` file
it finds. Only folder listings are read on the way, never file contents. Data files in a project are listed by name only, and a file
chosen in the Import Data dialog is handed to R as a path in the import
code. The app never opens data files; R reads them, for the preview and
when the import code runs. Every read and write is checked against that
set. A new project can be created only inside the folder chosen in its
dialog moments before. Reads are capped in size, and writes go to a
temporary file that replaces the original only once it is complete, so a
failed save never leaves a half written file.

Help pages come from installed R packages, which anyone can publish. The
HTML R produces for them is parsed into an inert document and rebuilt from
an allowlist of plain tags and a few harmless attributes before it is
shown, so a help page cannot run scripts, load styles, frames, or images,
or reach the network. Links between help pages are followed by the app
itself, and any other link is shown as plain text.

## Rendered reports

Rendering runs Quarto, or rmarkdown in a new Rscript, on a report
you opened, with the R you chose. The file must be in the same set of
chosen files every read and write is checked against. The file name and
format reach R as command line arguments, never inside the R code, so a
file name cannot change what runs.

The preview shows the rendered report in a frame. The report is
your own work, but it carries scripts, so the frame is sandboxed: the
report's scripts run, but it has its own origin and cannot reach the app or
its commands. The files it loads come through Tauri's asset protocol,
which starts with nothing allowed and is opened, after each render, only
for the folder the rendered file is in. The app's own Content Security
Policy allows frames from that protocol and nowhere else. Opening a
rendered file in its own app, or showing it in Finder, works only for
files a render in this session made.

## Shiny apps

Running a Shiny app starts it with `shiny::runApp()` in a new Rscript, on
a script you opened, with the R you chose. As with reports, the
file must be one of the chosen files, and its name and port reach R as
command line arguments, never inside the R code. The app listens on the
loopback address, 127.0.0.1, on a port the system picks as free, so it
cannot be reached from another computer. The App pane is shown the app
only once that loopback address answers, and only an address on
127.0.0.1 is accepted from what R prints, so a line printed by the app's
own code cannot point the pane somewhere else.

The app is shown in a sandboxed frame. It has its own origin, the
loopback address, so its scripts, forms, and connection back to its R
work, but it cannot reach the app around it or its commands. The app's
Content Security Policy allows frames from the loopback address for this.
Open in browser hands the system's browser the running app's address,
which the Rust side holds; the interface cannot pass it another one. One
app runs at a time, and it is stopped, with every process it started,
when it is stopped from the pane, when another app runs, and when the
window closes.

## Sharing an app as a web page

Exporting runs `shinylive::export()` in a new Rscript on an app you
opened, into a new folder inside the folder you choose in the system
dialog. The app's path, the folder, and whether it is a single file reach
R as command line arguments. The folder is always new, so an export never
writes over existing files. shinylive bundles every file in the app's
folder, and the Share dialog lists them before anything is made, pointing
out data, so nothing is shared by surprise. The app uploads nothing.

The preview serves the exported folder from the core on a loopback port.
It answers only GET and HEAD, refuses any path that would leave the folder,
including encoded parent steps and links that point outside it, and serves
only folders an export made in this session. Stop ends it.

## What the code does about R

R runs as a separate process, ark, started by the app and stopped with it.
Each project, and each script that belongs to no project, has its own ark,
so code in one cannot see another's objects. The interface names a session
by a key the core checks: a project must be one that is open, and a script
one you chose, so the interface cannot start R in a folder of its
choosing.
The app and ark talk over ports on the loopback interface only. Each session
generates a new random key, written to a connection file readable only by
your user account, and every message in both directions is signed with it.
A message with a missing or wrong signature is discarded, so another program
on the computer cannot send code to your R session or inject output into
the editor.

ark is not built from source here. `scripts/fetch-ark.mjs` downloads one
pinned release from Posit's GitHub releases and compares its SHA256 against
values recorded in the script before it is used, and the release build
signs it with the app's own Developer ID certificate.

Names that the app passes to R, such as package names to check or install,
are quoted as R string literals or rejected if they are not valid package
names, so text in your code cannot turn into a different R call.

## The optional assistant

The assistant is off until you set it up. It talks to Ollama over
its HTTP interface on the loopback address only, and the client is built
to bypass any proxy, so no request can be routed off the machine. The
interface never talks to Ollama itself; the core does, through commands
listed in `src-tauri/src/assistant.rs`.

The private copy of Ollama is one pinned release, downloaded from Ollama's
GitHub releases with the macOS `curl` and compared against the SHA-256
Ollama publishes for it before anything is unpacked. A mismatch deletes the
download and installs nothing. The copy is unpacked beside its final folder
and moved into place only when complete, runs only while the app is open,
listens on its own loopback port, and keeps its models in the app's data
folder. Removing it from the setup screen deletes that folder.

The machine check reads total memory, free disk space, and the chip name
with `sysctl` and `df`, only after you agree, and keeps nothing.

The model is told the code you asked about, R's error message, the
R version, and the names of objects and table columns in the session. It
is never sent the values in the data. What the model writes is shown as
text: answers are rendered as plain text and code, never as HTML, so a
model cannot inject markup or script into the page. Its code is never run
by the app. It is inserted into the script only when you press
Insert or Replace, and Replace refuses to overwrite lines that changed
since the question was asked.

## What is out of scope

Code you run in R has the full permissions of your user account, as it
does in a terminal or any other R environment. The app does not sandbox R,
and installing a package runs that package's code. Only install packages
from sources you trust.

The app sends no telemetry and has no accounts. It reaches the network only
when R does, for example when installing from CRAN, and when you
set up the assistant, to download Ollama or a model you chose. Models
come from Ollama's own library, and their behavior is outside this
project's control.
