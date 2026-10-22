# Security

## Reporting a problem

Please report a security problem privately, not in a public issue. Open the
repository's Security tab and choose **Report a vulnerability**. The
maintainer reads these reports, and a fix is released before the problem is
described in public.

## What the app is exposed to

The interface runs in the system web view under a Content Security Policy
(a list of rules the web view enforces about what a page may load) that
allows no remote origin. Scripts, styles, and fonts load only from the app
itself. The only connection the page may make is to the app's own core.

The window may ask the system for a short, fixed list of things:
confirmation and message boxes, setting its title, and opening a link in
the browser. Open and Save dialogs are not on that list. The core shows
them itself. Links open only to this app's GitHub pages, to CRAN, to
Ollama's download page, and to Quarto's getting started page.

The interface cannot touch the file system directly. It asks the Rust
core, which reads and writes only files you chose. You choose a file in
one of these ways:

- in an Open or Save dialog that the core itself shows
- by dropping it on the window
- by opening it from Finder
- from the recent list, which only the core can add to

Opening a project, chosen by its `.Rproj` file in the same way, adds the R,
R Markdown, and Quarto scripts inside that project's folder and nothing
else. Opening a script that sits inside a project does the same. The core
looks through the folders above the chosen script, stopping below the home
folder and the top of the disk, and opens the project whose `.Rproj` file
it finds. It reads only folder listings on the way, never file contents.

Data files in a project are listed by name only. A file chosen in the
Import Data dialog is handed to R as a path in the import code. The app
never opens data files. R reads them, both for the preview and when the
import code runs.

Every read and write is checked against that set of chosen files. A new
project can be created only inside the folder chosen in its dialog moments
before. Reads are capped in size. Writes go to a temporary file that
replaces the original only once it is complete, so a failed save never
leaves a half written file.

Help pages come from installed R packages, and anyone can publish a
package. Before a help page is shown, the HTML that R produces for it is
parsed into an inert document and rebuilt from an allowlist of plain tags
and a few harmless attributes. A help page therefore cannot run scripts,
load styles, frames, or images, or reach the network. The app follows links
between help pages itself, and shows any other link as plain text.

## Rendered reports

Rendering runs Quarto, or rmarkdown in a new Rscript, on a report you
opened, with the R you chose. The file must be in the same set of chosen
files that every read and write is checked against. The file name and
format reach R as command line arguments, never inside the R code, so a
file name cannot change what runs.

The preview shows the rendered report in a frame. The report is your own
work, but it carries scripts, so the frame is sandboxed. The report's
scripts run, but the frame has its own origin and cannot reach the app or
its commands. The files it loads come through Tauri's asset protocol. That
protocol starts with nothing allowed, and after each render it is opened
only for the folder the rendered file is in. The app's own Content Security
Policy allows frames from that protocol and nowhere else.

Opening a rendered file in its own app, or showing it in Finder, works only
for files that a render in this session made.

## Shiny apps

Running a Shiny app starts it with `shiny::runApp()` in a new Rscript, on a
script you opened, with the R you chose. As with reports, the file must be
one of the chosen files, and its name and port reach R as command line
arguments, never inside the R code.

The app listens on the loopback address, 127.0.0.1, on a free port the
system picks, so it cannot be reached from another computer. The App pane
shows the app only once that loopback address answers. From what R prints,
the pane accepts only an address on 127.0.0.1, so a line printed by the
app's own code cannot point the pane somewhere else.

The app is shown in a sandboxed frame with its own origin, the loopback
address. Its scripts, forms, and connection back to its R work, but it
cannot reach the app around it or that app's commands. The app's Content
Security Policy allows frames from the loopback address for this purpose.

Open in browser hands the system's browser the running app's address. The
Rust side holds that address, and the interface cannot pass it a different
one.

One app runs at a time. It is stopped, along with every process it started,
when you stop it from the pane, when another app runs, and when the window
closes.

## Sharing an app as a web page

Exporting runs `shinylive::export()` in a new Rscript on an app you opened.
The output goes into a new folder inside the folder you choose in the
system dialog. The app's path, the folder, and whether the app is a single
file all reach R as command line arguments. The folder is always new, so
an export never writes over existing files.

shinylive bundles every file in the app's folder. Before anything is made,
the Share dialog lists those files and points out data, so nothing is
shared by surprise. The app uploads nothing.

The preview serves the exported folder from the core on a loopback port.
It answers only GET and HEAD requests. It refuses any path that would leave
the folder, including encoded parent steps and links that point outside
it. It serves only folders that an export made in this session. Stop ends
it.

## What the code does about R

R runs as a separate process, ark, which the app starts and stops along
with itself. Each project, and each script that belongs to no project, has
its own ark, so code in one cannot see another's objects. The interface
names a session by a key that the core checks. For a project, it must be
one that is open. For a script, it must be one you chose. So the interface
cannot start R in a folder of its choosing.

The app and ark talk over ports on the loopback interface only. Each
session generates a new random key and writes it to a connection file that
only your user account can read. Every message in both directions is signed
with that key, and a message with a missing or wrong signature is
discarded. Another program on the computer therefore cannot send code to
your R session or inject output into the editor.

ark is not built from source here. `scripts/fetch-ark.mjs` downloads one
pinned release from Posit's GitHub releases and, before it is used,
compares its SHA-256 against values recorded in the script. The release
build signs it with the app's own Developer ID certificate.

Names the app passes to R, such as package names to check or install, are
quoted as R string literals, or rejected if they are not valid package
names. That way, text in your code cannot turn into a different R call.

## The optional assistant

The assistant is off until you set it up. It talks to Ollama over Ollama's
HTTP interface on the loopback address only, and the client is built to
bypass any proxy, so no request can be routed off the machine. The
interface never talks to Ollama itself. The core does, through the commands
listed in `src-tauri/src/assistant.rs`.

The private copy of Ollama is one pinned release, downloaded from Ollama's
GitHub releases with the macOS `curl`. Before anything is unpacked, it is
compared against the SHA-256 that Ollama publishes for it. If they do not
match, the download is deleted and nothing is installed. The copy is
unpacked beside its final folder and moved into place only when complete.
It runs only while the app is open, listens on its own loopback port, and
keeps its models in the app's data folder. Removing it from the setup
screen deletes that folder.

The machine check reads total memory, free disk space, and the chip name
with `sysctl` and `df`. It runs only after you agree, and it keeps nothing.

The model is told the code you asked about, R's error message, the R
version, and the names of objects and table columns in the session. It is
never sent the values in the data.

What the model writes is shown as text. Answers are rendered as plain text
and code, never as HTML, so a model cannot inject markup or script into the
page. The app never runs the model's code. The code goes into your script
only when you press Insert or Replace, and Replace refuses to overwrite
lines that changed since the question was asked.

## What is out of scope

Code you run in R has the full permissions of your user account, as it
does in a terminal or any other R environment. The app does not sandbox R,
and installing a package runs that package's code. Only install packages
from sources you trust.

The app sends no telemetry and has no accounts. It reaches the network only
when R does (for example, when installing from CRAN) and when you set up
the assistant, to download Ollama or a model you chose. Models come from
Ollama's own library, and their behavior is outside this project's control.
