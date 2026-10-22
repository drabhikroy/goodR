# Design rationale

This page records why the interface looks and behaves the way it does.
It has been rewritten several times as the layout moved away from
RStudio's four panes to the current two surfaces: the script, and a
canvas beside it where everything R makes lands.

## What changed and why

### Less on each result

The fourth design was judged too busy in use, and the complaint is a
familiar one. Word processors and qualitative analysis packages are often
described as bloated, and McGrenere and Moore (2000) found that most people
use a small part of such programs and feel the rest gets in their way.
The remedy that held up in their follow up was not to remove features but
to keep the everyday set in front and the rest one step away (McGrenere,
Baecker, and Booth 2002), a pattern Shneiderman (2003) calls a multi layer
interface. This app already layers its menus as Essentials and Everything.
The fifth design applies the same idea to the window itself:

| Fourth design | Fifth design |
| --- | --- |
| Each result a card with a title bar, a Code tag, a line label, stripes, and three text buttons | Code lightly tinted, the result in a well beneath it, one rule down the left joining them |
| Run Again, Copy, and Hide Result always on show, on every result | The same three as small labeled icons, shown on pointer hover or keyboard focus |
| A Result tag, a check, and a time on every result | A status line only when there is something to say: running, failed, stopped, waiting, or slow |
| An error drawn as a red block | An error on the ordinary surface, marked by a red rule, an icon, and a headline |
| Each plot full size in the script and again in the Plots pane | A small copy in the script that leads to the full plot in the pane |
| Objects as boxed cards with tinted icon tiles | Objects as plain rows, with View shown on the row in use |
| Bold resize grips on every edge | Faint grips that light up on hover |
| A keyboard shortcut shown inside the Run button | The shortcut in the button's tooltip and the menus |

Every one of these still exists. What changed is how many of them compete
for attention at once. Visual complexity lowers both first impressions and
measured performance (Tuch et al. 2009; Reinecke et al. 2013), clutter slows
search for the thing that matters (Rosenholtz, Li, and Nakano 2007), and
grouping by a shared region holds even when the region is marked with very
little ink (Palmer 1992), which is why one rule and a change of surface are
enough to keep a result with its code.

### Opening scripts and projects, not folders

The first version opened a folder and listed everything in it. That gave
the app access to files it had no business reading. The app now opens
individual scripts: R, R Markdown, and Quarto files. A file becomes
readable only when the person picks it in the Open dialog, drops it on the
window, opens it from Finder, or reopens it from the recent list. The Rust
side keeps that list itself, so the interface cannot widen its own access.

Projects came back in the third design, because organizing work into a
project folder is the habit R courses teach and RStudio users bring with
them. They return on narrower terms. A project is opened by its `.Rproj`
file, and opening it grants the scripts inside its folder and nothing else.
Data files are listed by name so they can be found, but the app never reads
them: choosing one writes the R code that loads it into the console, and R
does the reading. This is least privilege, the oldest rule of protection
design (Saltzer and Schroeder 1975): the app holds only the access its own
work needs. It also keeps the loading step visible as code the person can
copy into a script, rather than hiding it behind a click that leaves no
trace.

The opening screen leads with New project, the largest target on it,
because a project is the setup that serves a newcomer best, while opening a
project, starting a script, and opening one sit just below it.

### Which R a script runs in

RStudio runs one R per window, and a script opened while a project is
running joins that project's session whatever folder it came from. People
who work across several projects then have to remember which session each
file landed in, and an object from one project can quietly satisfy a name
in another's script, so the script seems to work and then fails for the
next reader. Hidden state of exactly this kind was a leading reason that
notebooks in a study of over a million failed to reproduce (Pimentel et
al. 2019), and keeping track of it in your head is the kind of extra load
a tool should take away (Sweller 1988).

Here, where a file lives decides where it runs. Opening a script looks for
a `.Rproj` in the folders above it, the same rule RStudio uses to define a
project. A script inside a project runs in that project's R, however it
was opened. A script that belongs to no project gets an R of its own,
started in its folder, so `"data.csv"` means the file beside it. Untitled
work runs in the session of the tab in front, or in an R kept for it when
nothing is open. Several projects can be open at once, each in its own R,
and opening one no longer closes the others.

The panes follow the tab: its console, objects, plots, history, and
project sidebar come forward with it. The session's name sits beside R's
status at all times, and its menu lists the other sessions, so the state
that decides what a line will do is always on show rather than remembered
(Nielsen 1994, visibility of system status; recognition rather than
recall). Code run while a new session's R is still starting waits and runs
when it is ready, rather than asking to be run again.

The cost is memory: each R is its own process. A script's own R ends when
its tab closes, and a project's when the project closes, so only work that
is open holds an R.

### Fewer things on screen at once

The first workspace showed about twenty controls before any code ran: a
project switcher, a status pill, a search box, a stop button, a run button,
a file tree, an outline, tabs, a three part layout switch, a live output
switch, a console header, a status bar, and the inspector. Measured visual
clutter slows search for what matters (Rosenholtz, Li, and Nakano 2007), and
people judge busier, less prototypical screens as less attractive within
the first moments of seeing them (Lindgaard et al. 2006; Tuch et al. 2012;
Reinecke et al. 2013). Decision time also grows with the number of choices
on offer (Hick 1952; Hyman 1953).

The workspace now has one bar. Open scripts sit on the left with the
section the cursor is in beside them. Three controls sit on the right: R's
status, where results appear, and Run. Everything else lives in the menu
bar and the command palette.

| Before | Now |
| --- | --- |
| File tree and outline in a sidebar | Section menu beside the tabs, shown only when a script has sections |
| Three icon buttons for the output layout, plus a live output switch | One labeled Results menu |
| Separate Stop button | Run becomes Stop while R works |
| Status pill, working folder in the console header, status bar | One R button that opens the working folder, Restart R, and Choose R version |
| Console always showing everything run | A console drawer that records only what was typed there, resizable by drag or arrow keys |

### Labels instead of bare icons

The three output layout icons were the least clear controls in the first
version. Labels are learned faster and remembered better than icons alone
(Wiedenbeck 1999), so the layout choice is now a menu of plain names: under
each line, beside the code, below the code. Each menu item shows its
keyboard shortcut, because seeing shortcuts beside the commands they run is
what moves people from menus to the keyboard (Lane et al. 2005).

### Results attached to their code

Placing related information together, rather than in separate places the
reader must hold in mind and connect, improves understanding (Ginns 2006, a
meta-analysis of the spatial contiguity effect). Studies of notebooks find
the same need in data work: people want output beside the code that made it,
and lose track when the two drift apart (Kery et al. 2018; Rule, Tabard, and
Hollan 2018; Chattopadhyay et al. 2020). Lau et al. (2020) map the space of
notebook designs and treat where output appears as a core choice, which is
why the app offers two placements rather than one: in the canvas, beside
the script, each result a card that names and links to its line, or
under each line of the script itself. Either way the script shows a check
beside each line that ran and underlines the part of a line that failed,
so the link between code and outcome is kept.

The second design removed the frames around results to cut clutter, and in
use it went too far: code and output ran together, and one statement's
result was hard to tell from the next statement's code. The third design
made each statement with output one card, but the line between its code
and its result was still too faint.

The fourth design took its card from HyperCard, with a title bar, tags,
stripes, and a hard shadow. In use that was too much: five rows of chrome
around a one line answer. The fifth design keeps what made the card work and
drops the rest. A statement with output has its code lines lightly tinted,
and its result sits in a recessed well right below them. One rule runs down
the left edge of both, so the two read as a single unit, while the change
of surface keeps input and output apart. Elements inside a common region
are seen as one group even when the region is marked lightly (Palmer 1992).
Run Again, Copy, and Hide appear at the top right of a result while the
pointer is over it or keyboard focus is inside it. Each is an icon with a
name for screen readers and a tooltip.

Statements that print nothing, such as an assignment, do not get a well.
They stay plain code with a check in the gutter, so a script reads as code
with answers rather than a wall of boxes. Results that need attention, an
error, a stop, a run in progress, say so in words beside an icon, and the
rule beside them grows thicker, so the state is carried by shape as well as
color.

A line that adds to a plot already on screen, such as `abline()`,
`lines()`, or `legend()`, redraws that plot in place. R reports these as an
update to the existing picture rather than a new one, and the fourth
design ignored the update, so such lines seemed to run and do nothing. The
plot is now redrawn in the Plots pane, the result under the line shows the
new picture, and the plot's code grows to include the line, so an export
draws the whole picture.

Pointing at or focusing a result highlights the
lines that produced it, so the link between them is shown rather than
inferred. While R runs a statement, an orange bar in the margin marks it.
The orange is the colon in the app icon, the one accent color in the
interface.

The console used to repeat every editor result, so each one appeared twice.
It now records only what was typed into it, plus messages from the app such
as a change of working folder.

### Plain results as an option

The tinted code and result wells suit many people, and they are the
default, but they are a new look for R, and some people will prefer the
page they know. Results can therefore be Plain text, printed straight
under their code on the editor's own background with no well or tint, or
can go to the console. A person who can shape an interface to their own
taste tends to prefer it to one that changes itself or never changes
(Findlater and McGrenere 2004), and keeping the choice to one setting with
a live effect keeps it cheap to try. Either way, a result never runs wider
than the visible editor. Its text wraps inside the window, even when a
long line of code makes the editor scroll sideways.

### Copying what you select

A selection could run across several results, but a copy took the code
alone, so a person who selected three results to paste into a report got
none of them, and it seemed only one result could be copied at a time. A
copy now takes everything selected, in order: each statement, then its
result as plain text, as it would read in a console. Settings can limit
copies to the code, for people who paste into other scripts.

### Error messages and where they point

R's messages are written for people who already know R. They use words
such as closure, atomic vector, and binary operator, and they rarely say
which part of a line failed. Rewritten, more explanatory messages reduce
repeated errors among novices (Becker et al. 2016), how readable a message
is affects whether people can act on it (Denny et al. 2021), and a review
of four decades of this research finds location and a concrete next step
among the most consistent recommendations (Becker et al. 2019).

Each error now has three parts in a fixed order: a headline that says what
happened, a plain explanation of why, and one thing to try. The part of the
code that failed is shown twice: in the result, as the line of code with
the failing part in bold and a row of carets under it, and in the script,
with a wavy underline that goes away as soon as that part is edited. Go to
the Spot selects the marked part so it can be retyped at once. People
repair errors faster when the message points at the code than when it only
describes the problem (Marceau, Fisler, and Krishnamurthi 2011).

Finding the spot takes work that R does not do on its own. For a name R
could not find, the app looks for that name in the code, skipping text in
quotes and comments. For an error deep inside a function, it walks the
calls R reports from the innermost outward and marks the first one that
appears in the person's code, since that is the part they wrote and can
change. For a line that will not parse, the console's message has no
position, so the app asks R's parser, which names the line and column,
without running anything. When an operator could be the culprit but the
line has several, nothing is marked, because pointing at the wrong one
would mislead. A one click fix is offered when one is clear, and R's own
message stays one click away. Console errors get the same plain version,
with carets under the code that was typed.

### An assistant on the person's own computer

Language models can explain errors and code in plainer words than a fixed
table can (Leinonen et al. 2023), and code generators helped novices write
and later understand code in a controlled study (Kazemitabaar et al. 2023).
They also make mistakes with confidence, and people tend to accept
automated suggestions without checking them, which is called automation
bias (Goddard, Roudsari, and Wyatt 2012). The assistant is built around
both findings.

It is optional and off until set up. It runs through Ollama on the
person's computer, so no code, data, or question leaves it, and it is told
the names of the objects in the session and the columns of tables but
never the values in them. Setup follows the same three steps as the other
apps in this family: Ollama first, either the copy already on the Mac or a
private copy kept inside the app and checked against its published
checksum; then an optional check of the Mac's memory and disk, which asks
first; then a short list of models, each with what it is good and weaker
at for this work. The list is short because more choices make a first
choice slower and harder (Hick 1952; Iyengar and Lepper 2000), and the
suggestion comes from fit alone, never from the maker. Models already
downloaded with Ollama are found and can be used.

Against automation bias, nothing the model writes runs by itself. Its code
goes into the script only when the person presses Insert or Replace, and
before that R's parser reads it, without running it, and the answer says
whether R can read the code. Replace puts the new code over the lines it
was asked about only if those lines have not changed since, and Undo
reverses it. Replace is offered only when the suggestion shares most of its
names with the original, so a fix that is really a different step, such as
installing a missing package, can never wipe out the line it was about.
That kind of step gets Put in the Console instead, where it waits for
Return.

The help it gives sits where the need arises: an Ask the Assistant button
on a failed line, and three one press requests for the code at the cursor,
Explain, Add Comments, and Make Clearer, alongside a box for any other
question. Answers stream in as they are written, and Stop ends one at any
point.

### Results as you type

Live programming shortens the gap between editing and seeing the effect
(Tanimoto 2013). Results that update as you type remain an option rather
than the default, and anything that writes files, installs packages, or
changes the session never runs that way.

### What carries over from RStudio, and the right side

Most people who come to this app will have used RStudio, often for years.
A layout close to the one people expect is judged more favorably at first
sight (Tuch et al. 2012), and skill carries over to a new tool in
proportion to what the two have in common (Singley and Anderson 1989). So
what people reach for by habit stays where they reach: the script above
the console, the same pane names, and RStudio's shortcuts, Control and a
number to move to a view, Shift Command M for a pipe, Option minus for an
assignment arrow, Shift Command R for a section, and F1 for help at the
cursor. The inspector's width, the console's height, and the height of its
typing box can each be dragged or moved with the arrow keys, following
the WAI-ARIA window splitter pattern, and each size is remembered.

What the sixth design kept from RStudio and the seventh drops is the
two stacked panes on the right. They cut every view to half the window's
height, so a plot comes out small, a help page scrolls after a few lines,
and an empty environment holds space it does not use, while two tab
strips compete for the eye. The seventh shows one view at a time at full
height, chosen from a rail of labeled icons along the window's edge.
Labels beside icons are learned faster and remembered better than icons
alone (Wiedenbeck 1999). The rail stays when the view is hidden and
carries small signs of change, how many objects and plots exist, and a
dot while a report renders or an app runs, so state elsewhere stays in
view without a pane open to show it (Nielsen 1994, visibility of system
status).

The first run of the built app on a Mac, rather than the browser build
used while designing it, found three places where this went wrong, and
each was corrected on the spot rather than left for a later design.

A plot from a script first showed at full size in its card whenever the
Plots view was not the one open, since the thumbnail shown here had been
written to depend on that. A tall plot then ran past the bottom of the
window, after a wall of a regression summary's own output, which is the
opposite of plots being easy to see. A result card now always shows a
small preview, named and linked to the Plots view, whichever view is
open; the full picture is a press away and never blocks the scroll
(Palmer 1992, common region, for the preview read as one small unit
rather than competing with the output around it).

The inspector's width, read from what was last remembered, was applied
to the view without being checked against the window. A width remembered
from a wider window, or widened for a report or an app, could then take
close to half of a laptop screen, which is the opposite of space going to
the work. The width is now capped to the window every time either
changes, and the cap itself was lowered. The same bug, and the same fix,
applied to the console's height.

Closing every open file was the only way back to the opening screen, so
starting a new project, or finding a different recent file, meant giving
up what was open to get there. Home, in the title bar, now shows the
opening screen over the workspace without closing anything: R keeps
running, every tab stays open, and Continue working, its own shortcut, or
Escape return to them exactly as they were. Opening or starting anything
from the opening screen does the same.

The same person's first reaction to the right side was that it was
confusing, took a lot of space, and hid plots, and the rail of the
seventh design is gone as a result. In use it was a second column of
navigation beside the panel it controlled, it read as one more toolbar,
and since only one view showed at a time, every plot from a script waited
behind the Plots tab, with only a count to say it was there. That last
point broke the principle the rail was meant to serve, that state should
stay in view (Nielsen 1994), for the output people look at most.

The side panel now has its views named in a row of plain text tabs along
its own top, the form people most readily recognize as tabs, and the
column the rail held goes to the script. Its first view, Workspace,
shows the objects and the plots at once: the objects as a short list at
the top, sized to what they hold and scrolling past about a third of the
panel, and the current plot in the rest, so a plot is seen the moment it
is made. This is the one thing RStudio's stacked panes did well, and it
is kept without their cost, since the objects take only the room they
need and fold away to their heading. Every plot of the session sits in a
strip of small copies under the current one, so going back to an earlier
plot is a glance and a press rather than a count of arrow presses
(recognition over recall, Nielsen 1994). A new plot brings Workspace
forward, unless a help page, a report, an app, or the assistant is being
read and the plot also has its card under its code. History moved into
the console, as a button in its head that swaps the output for the past
commands, which puts it beside the record it comes from and takes a view
out of the panel. A button at the end of the title bar shows or hides the
whole panel, since the rail had been the way back to it.

### The script and the canvas

The side panel above was the seventh design's last version, and it was
still judged to look like RStudio, rightly. Tabs for views, a drawer for
the console, and a list of objects are RStudio's four panes in a new
arrangement, and they keep RStudio's real cost: what R says is split
across places. A value prints in the console, its plot appears in another
pane, the object it made in a third, and the person connects them. The
eighth design was chosen from three sketches put to the person who
reported the problem, a canvas beside the script, a single notebook
across the window, and a stage showing one result at a time, and is the
first of them.

The window now has two surfaces. The script is on the left. The canvas
on the right holds everything R makes, in the order it was made. Placing
related material together rather than apart helps people connect it
(Ginns 2006), and a single chronological record is what notebook users
rebuild by hand when output is scattered (Kery et al. 2018).

The first version of the canvas was a feed of cards, newest at the
bottom, with each plot as wide as the canvas. In use on a laptop, plots
were still hard to see: a feed shares its height among every result, so
a plot was a short strip between text, and a long run pushed it out of
view. The canvas now has a stage and a timeline, the third of the
sketches, chosen over a set of separate windows and a full screen
results page. The stage shows one output at a time, as large as the
space allows: a plot scaled to fill its height as well as its width,
rendered by R at the stage's own size so its text is in proportion; a data
frame shown by its name as the data viewer's table, which can be sorted;
and printed text in a block that is easy to read. This is focus plus
context (Card, Mackinlay, and Shneiderman 1999): one item at full size,
with every other item still in view as a small preview in the timeline
underneath, one press or arrow key away, rather than recalled by
scrolling (Nielsen 1994). A new output takes the stage as it arrives,
and moving the cursor onto a line brings back what that line made, so
the stage follows the person's reading of the script without a press.
Pinning keeps one output on the stage above the current one, since
comparing two plots, or a plot and the table behind it, is otherwise a
matter of memory.

The R prompt is a box under the script, and what it runs takes the stage
and joins the same timeline as results from the script, rather than
printing in a separate drawer. The objects in R sit as small cards along the canvas's top,
always in view without a pane of their own. R help, Packages, History,
the assistant, and a rendered report or a running app are sheets that
slide over the canvas from buttons beside the cards and close back to
it. Running code brings the stage back from under a sheet, so a result is
never hidden behind one, except a report or an app, which people watch
while they work. A search field in the title bar opens the command
palette, which now also looks names up in R's help, so one field finds
both what to do and what a function means. Results under each line of the
script remain a choice in the Results menu, for people who prefer them
there, and the former placements beside, below, and in the console are
folded into the canvas, which serves all three purposes.

The title bar and the document were also pulled apart. The sixth design
put the tabs, the section menu, R's status, the Results menu, Render, and
Run in one row, all of equal weight. The seventh keeps the title bar for
the window: the tabs, and the R session they run in, as one pill. What
acts on the file in front moves to a bar across the top of the document
itself, ending in Run, so each control sits next to what it acts on and
reads as part of it (Palmer 1992). Render and Run app appear on that bar
only for files they apply to. The document and its bar are one raised
panel, the only one with a shadow, since it is where the work is.

This app departs from RStudio on purpose in two ways. Results sit
with their code rather than only in the console, and the project sidebar
lists scripts and data rather than every file in the folder.

The fifth design kept RStudio's grid of edge to edge boxes, with a title
bar, tab strips, and borders between every area, and in use it felt like
RStudio in a different coat, busy and heavy. The sixth keeps the four
areas and changes how they sit. Each is a rounded panel floating on a
tinted backdrop, with a clear gap between panels instead of a line, and
one toolbar runs across the top for the script tabs, the section menu,
R's status, the Results menu, and Run. Space between groups separates
them at least as well as a border does, with less to look at (Palmer
1992; Rosenholtz, Li, and Nakano 2007), and the gaps double as the edges
that drag to resize. The tabs in each panel are a segmented control, so
the one on show is plain from its raised surface rather than from color
alone.

### Completion, help, and packages from R itself

The typing box at the R prompt is a small code editor, so typed R is
colored as in the script and brackets match. In both places, suggestions
come from the completion engine R ships for its own console, the one
RStudio builds on, so they know the objects in the session, a function's
arguments inside its parentheses, and a data frame's columns after a dollar
sign. They appear after three characters, as in RStudio, and Tab asks at
any point or takes the highlighted suggestion.

Help pages are R's own. Typing ?mean at the prompt, searching in the
title bar or the R help sheet, or pressing F1 shows the page in the sheet,
and links between pages open there too. The HTML that R produces is rebuilt from an allowlist of
plain tags before it is shown, so a package's help can never run code or
reach the network. A side effect is that help follows the app's text size
and appearance. The Packages sheet lists what is installed, and attaching
or detaching a package runs the matching line at the prompt, where it can
be seen and copied.

### Importing data

The Import Data dialog follows RStudio's: choose a file, see its first rows
as R reads them, adjust the separator, decimal mark, missing value markers,
rows to skip, or the sheet of a workbook, and see the exact code before it
runs. For a text file, R reads the first lines and the dialog guesses the
separator and decimal mark, so a semicolon file saved by a European
spreadsheet previews correctly at once. The code runs at the prompt and,
by default, is also added to the script, because an analysis that records
how its data was read can be run again from the top (Sandve et al. 2013).
The app itself still never opens a data file; R does.

### A reload of the window no longer restarts R

In development, and in some conditions on the Mac, the window's page can
reload while the app keeps running. Each reload used to start a new R and
end the old one, which looked like the app restarting and lost every
object. The interface now asks for the running R first and reconnects to
it, and unsaved script changes are kept in the window's own session
storage, so a reload loses nothing. The packages the interface needs are
also prepared before it first loads, which removes the reload a fresh
install used to cause.

### The opening screen

The opening screen offers one main way in, a new project, with three
smaller ones beside it, next to the projects and scripts opened before.
Recent work is recognized rather than recalled (Nielsen 1994).

R starts with the app rather than with the first file, so by the time
anything is open it is ready, and the opening screen says so in one line.
Waiting for R after choosing a file was a delay at the exact moment the
person wanted to begin. When a project then opens, an R that has not run
anything yet moves into the project folder instead of restarting, so the
person never sees R start twice.

### Moving between the script and the stage

Results are only useful next to the code that made them when the link
can be followed in either direction without a search. Pressing an output
in the timeline, or moving along it with the arrow keys, now puts the
script's cursor on the statement that made it, and clicking a statement
brings its output to the stage; while it is there, the statement keeps a
bar down its left edge, so the two read as one (Palmer 1992, common
region, applied across the two panels through a shared mark). The stage's
own line label is a link to the same place.

A long script makes many outputs, and a row of thirty previews is no
easier to search than a scroll of them. The timeline now groups outputs
under the sections of the script they came from, the same section
comments the section menu uses, so the row reads as a few named groups.
Past six outputs, filters narrow it to plots, printed results, or
problems, each with a count, so finding the one plot or the one failure
in a long run is one press (Shneiderman 1996: zoom and filter after the
overview).

The R prompt moved back under the script. It had moved to the foot of
the canvas with the results, but in use it belongs where the code is
being written: the eye is already on the left, and the stage still
shows what the prompt runs.

### Finding what really went wrong in a Shiny app

Errors in Shiny apps are hard to place, and RStudio does little about
it. Many mistakes give no error at all: an output id spelled one way in
the UI and another in the server simply never appears, and an input read
under the wrong name is always NULL. Others fail far from their cause, as
a reactive used as data rather than data() does, with a message about
closures. And when code fails inside a render function, Shiny prints
the name of the function that failed and a stack trace that most people
do not read, so the line they look at is often not the line that broke.

Two things address this. First, the app's code is read as it is
written, with no R needed, for the mistakes Shiny never reports at their
cause: output and input ids that do not match between UI and server,
with the closest id offered as a fix; reactives used without their
parentheses; inputs read outside a render function, reactive, or
observer; render functions that cannot fill the output they are paired
with; and ids used twice. Each is underlined where it is, quieter than a
real error, and listed above the script with Go to line and a fix where
one is clear. An app split into ui.R and server.R is read as one. The
reader stays quiet about apps built from modules or ids made with
paste(), where it cannot be sure. Catching problems where they are made,
rather than when their effects appear, is what makes them cheap to fix
(Becker et al. 2019 on error messages that point at the cause).

Second, when something fails inside a running app, the stack trace Shiny
prints after the error is read for the place. Shiny marks each call in
the app's own files with its file and line; the innermost one is where
the error happened, the next is the render call or reactive that led
there, and the frames name the output being made. The App sheet says
all of that in one sentence, such as line 9 of app.R, in helper(),
called from renderPlot on line 17, while drawing the plot output,
underlines the spot, goes there in one press, and offers the closest
name in the file when the error is a name that was not found.

### Help, a tour, and examples

People starting with software want to do something real with it rather
than read about it first (Carroll and Rosson 1987), so help here leads
with two actions. Open the examples copies a small project into the
Documents folder and opens it: first steps, data frames, plots, a model,
errors made on purpose to show how they are explained, a Quarto report,
two R Markdown files, and three Shiny apps. One of the apps has four
mistakes on purpose, the kind the Shiny checker finds, and a unit test
holds the checker to finding exactly those four.

The examples use real data rather than the datasets that ship with R and
fill every course and tutorial. People skim past iris and mtcars because
they have seen them many times, and a dataset with a question worth
asking holds attention better than one chosen for convenience. Each
example asks one: how many of the meteorites ever found came off the
Antarctic ice, whether lit windows kill more migrating birds, whether a
regression can find Kepler's third law in planets around other stars
(it finds powers of 1.49 and minus 0.45, against 1.5 and minus 0.5), and
how the space race changed hands. The data keeps its real mess, such as
unknown places written as latitude 0 and longitude 0, because cleaning
it is part of the lesson. Every dataset is in the public domain or under
an open license, credited in the project's README. Templates for new
projects use quakes, a record of earthquakes near Fiji that comes with R,
so they still need no data file. Every
example runs on a fresh R with no extra packages, apart from the apps,
which offer to install shiny. Opening them again restores any file that
was deleted and keeps every change, so they can be edited freely.

The first tour, seven text cards in a corner, was judged bland and not
much of a guide. It now follows the walkthrough in Tessera: a card in
the middle of the window with one point per step, a small animated
picture of that point drawn in the app's own colors, a row of dots for
where it is, and Back and Next, also on the arrow keys. Pictures help
people learn from instructions when they show what the words describe
rather than decorate them (Mayer 2009), so each one acts out its step:
a line of code lighting up and its output arriving, bars growing to
fill the stage, a selection hopping along the timeline. It opens by
itself on the first run and from Help or the opening screen after that.

Describing a part of the window still leaves people looking for it, so
each step that names a part has Show me, and so does every Help topic.
Show me sets the tour or Help aside, opens the examples first when
nothing is open, and marks the part with an outline and three rings that
widen out from its center and fade, one after another, with its name in
a label. Movement in the periphery is noticed faster than any change of
color or size (Bartram, Ware, and Calvert 2003), which is why the rings
move, and they stop on their own after a few seconds, or at the next
click or key, so they never get in the way. With motion reduced, they
hold still as one steady ring. A spotlight that dims the rest of the
window was not used, since the rings find the part without hiding
anything around it.

The help page itself is written around the questions people have while
they work, how to run code, where results go, which R a script runs in,
what to do when something fails, rather than around the names of menus.
A first version put its topics in a grid of cards with the open one
below; it was judged hard to follow, since the grid gave no order and
the open topic sat out of view. It is now laid out as most documentation
sites are: the topics down the left, grouped in the order people meet
things (getting started, writing and running, making reports and apps,
fixing problems, and reference), with a search box that narrows them as
you type, and the chosen topic on the right with a Next link to the one
after it. It opens on Start here, which holds the tour, the examples, a
few common questions, and a small map of the window, every part of which
is a Show me button. Its text, like the rest of the app, is written in
plain words, as someone would say it. The keyboard shortcuts topic
is built from the same command list as the menus and the palette, so it
cannot fall out of step with them. Help shows over the workspace without
closing anything, as Home does.

### Seeing data

The data viewer follows the order Shneiderman (1996) proposed for
information displays: overview first, then zoom and filter, then details on
demand. The overview is in the column headers. Each shows the column's type,
a small bar chart of its values, its range or most common value, and its
missing count, so the shape of the whole table is visible before any
scrolling. Small word sized charts placed in line with text carry a
surprising amount of information in little space (Tufte 2006), and putting
a quality summary on every column, missing values above all, follows data
profiling tools built for this purpose (Kandel et al. 2012). Choosing a
column opens its details beside the table, with a one click plot and sort.

The viewer asks R for a hundred rows at a time, and sorts in R, so a table
of millions of rows opens as quickly as a small one, and the app never
holds a copy of the data.

### Exporting plots

People export plots for a few destinations again and again: a slide, a
document, and a journal. The export dialog offers those as presets, with
journal widths set to the common single and double column widths of 89 and
183 millimeters, and shows the shape of the file as the size changes.
Rather than enlarging the screen image, R draws the plot again at the
chosen size, so text keeps its proportions and a PDF or SVG stays sharp at
any zoom. The code runs in a scratch environment and the random number
state is restored afterward, so exporting never changes the workspace or
later results. When the code uses random numbers without setting a seed,
the dialog says plainly that the exported plot will show a new sample.

### The Run button

Run used to be one button for one action, Run line. Running a chunk or a
whole file meant knowing a shortcut or opening a menu. Run is now a split
button: the button runs the usual thing, and the arrow beside it lists
every way to run, each with its shortcut shown, so the menu teaches the
keys as it is used (Lane et al. 2005).

What the button runs depends on the file. A script runs a line, the step
people take most while working through code. A document runs a chunk,
its natural unit. The person can change this for any one file from the
same menu, so a script that always runs top to bottom can carry a Run
file button. The choice is the person's, set in plain view, never
inferred: adaptable menus, which people arrange themselves, were faster
and better liked than adaptive ones that rearrange on their own
(Findlater and McGrenere 2004). The button always names what it will do,
"Run line", "Run chunk", or "Run file", so the default is never a hidden
mode.

In a script, a chunk is a section: the code under a comment such as
"# Clean ----", the convention RStudio already uses for its outline. A
script with no sections runs whole.

### Writing R Markdown and Quarto

A document mixes prose and code, and the editor now treats it that way.
Prose is highlighted as Markdown, with headings set by weight and size
rather than color, and code inside each R chunk is highlighted as R. Each
chunk sits on a tinted band with a rule down its left side, so the two
kinds of text read as separate regions at a glance (Palmer 1992), and
its header carries a Run chunk button. Running a line, a chunk, or the
whole document sends only R code: the header, the prose, and chunks in
other languages are left out, and every result still lands under the line
that made it. A cursor in prose says that the line is text rather than
reaching ahead to the next chunk.

New document asks three questions, Quarto or R Markdown, a title and
author, and the format, each with a default, and starts the file with a
header and two example chunks. A newcomer gets something that renders on
the first press and shows where writing and code go, rather than an
empty page (Carroll and Rosson 1987). Quarto is the suggested kind
because its PDF needs no LaTeX.

### Reports rendered beside the code

A report renders in a fresh R of its own, not in the console's session, as
RStudio does when it knits. A report is meant to be rerun by someone else,
and it should show what its own code makes from nothing, which is a basic
rule of reproducible work (Sandve et al. 2013). Rendering in the console's
session would let an object made by hand slip into the report and then
fail for the next reader. The cost is a surprise: a name that works in the
console can be missing in the report. When that is why a chunk fails, the
explanation says so in so many words, and says to create the object in a
chunk above.

The finished report appears in the Report pane beside the code rather than
in a tab over it, so a person can change a line, render again, and compare
without losing their place, for the same reason results sit with their
code (Ginns 2006). Open hands the file to the browser or to Word for a full
size view. While the render works, the pane shows which chunk it is on,
counted as knitr counts them, and the toolbar's Render becomes Stop. A
system that shows what it is doing, and lets a person leave, is one of the
oldest usability principles (Nielsen 1994).

PDF was first made only with Typst, a typesetting program that comes
inside Quarto, since LaTeX is a separate install, several gigabytes in
its full form, and a common place for newcomers to give up before their
first PDF. That left out everyone whose journal, template, or document
needs LaTeX itself. Now the app looks for a LaTeX already on the computer,
in the places MacTeX, TeX Live, MiKTeX, and TinyTeX install to, since
apps opened from the Dock do not see the PATH a terminal has. Left to the
app, a PDF uses that LaTeX when there is one and Typst when there is not,
so nobody is asked to install anything to get a first PDF. When a PDF
needs LaTeX and there is none, the explanation offers TinyTeX in place: a
small LaTeX kept up by Posit, about 120 MB, that adds the pieces a
document needs as it needs them. The app installs it with the tinytex R
package, which already knows where TinyTeX is published for each system,
into a folder of its own, so it never mixes with a LaTeX the person
installed and removing it is one press. The report renders again as soon
as it is ready, so the person never has to remember what they were doing.
Settings, under Reports, chooses Typst, LaTeX, or the automatic choice,
and which LaTeX to use when there are several. The chosen LaTeX goes first
on the PATH of every render, so a document whose header asks for LaTeX
finds it too.

A chunk that fails is explained by the same rules as an error in the
console, so the wording, the plain headline, and the one thing to try are
the same everywhere. knitr names the lines of the chunk that stopped, the
rules find the part of that chunk that failed, and the editor underlines
it, so the person goes straight from the message to the line.

### Shiny apps beside the code

A Shiny app runs in its own R, as a report renders, for the same reason:
an app is shared and run by other people, so it should work from its own
code alone (Sandve et al. 2013). RStudio runs an app in the console's
session, which locks the console until the app is stopped. Running it
apart keeps the console free to try a line while the app is open, so the
person never has to choose between the two. An app that needs an object
made only in the console fails here, and the explanation says why, in the
same words a report uses.

The app appears in an App pane beside the code, with the same room a
report preview gets, rather than in a separate window that covers the
script. Shiny watches the app's folder and reloads the app when a file in
it is saved, so the loop is: change a line, save, look, without pressing
anything else. Running the app saves its files first, including ui.R and
server.R beside the app.R that was run, since the app reads them from
disk and a stale file would show old behavior with no sign of why.

Run app appears only while a Shiny app is in the editor: a file Shiny
treats as an app by its name, or a script that builds one with
shinyApp(). A button that is always present but usually does nothing
would add to the clutter the rest of the window removes (Rosenholtz, Li,
and Nakano 2007), as the Render button for reports already does.

Errors come in two kinds, and they are shown differently because they mean
different things to the person. An app that will not start, because of a
syntax error or a missing name, ends, and the pane explains why with the
console's rules and marks the spot in the script, as for any other error
(Marceau, Fisler, and Krishnamurthi 2011). An error inside a running app,
such as a plot that fails for one slider value, does not stop it: Shiny
shows an error in that output's place and carries on. The pane then lists
the latest such error above the app, explained in plain words, and says
that the app is still running, so the person knows the rest of it can
still be tried.

### Sharing an app without asking anyone to install R

An app is made to be used by people other than its author, and the most
common obstacle is that they have no R. Sharing therefore makes a web page
with shinylive, which runs R inside the browser through WebAssembly, so
whoever opens it needs only a browser. The alternatives were weighed: a
folder with the app and a script that installs its packages still needs R
on the other computer, and bundling R itself into a program for each
system is large and fragile. The web page asks nothing of the person who opens it.

Sharing is where privacy mistakes happen, so the dialog lists every file
the page will hold before anything is made, and points out data among
them in words, since shinylive bundles the whole folder and anyone with
the address can download it. Showing what will be shared at the moment of
sharing, rather than relying on people to check, avoids the first two
pitfalls Lederer et al. (2004) name for privacy in interfaces: hiding
what could be disclosed, and hiding what actually is.

The page runs only from a web address, not from a file opened by double
clicking, which is the one thing about it that surprises people, so the
dialog says so, and its Preview serves the page the way a host would, in
the App pane, before it goes anywhere.

### Text size and code settings

The fifth design set the interface text at 14 pixels and several labels
smaller, which was hard to read at a normal viewing distance. The base is
now 15 pixels, nothing in the interface is set below about 13, and the
interface scales from 90 to 150 percent. Reading speed rises with print
size until it reaches a critical size, and text below that size slows
everyone, not only people with low vision (Legge and Bigelow 2011). Larger
type and more generous line spacing also make on screen text easier to
read and understand (Rello, Pielot, and Marcos 2016).

Code has settings of its own, because people read code differently from
labels and often know exactly what they like. Six monospaced typefaces are
offered, each named in its own letters and shown in a live sample of R,
with a size from 11 to 24 points and three line spacings. Typefaces that
join symbols such as `<-` and `!=` into single shapes can do so, and the
option says plainly when the chosen typeface cannot. The Editor section
switches line numbers, the band on the current line, wrapping, closing
brackets, brackets colored by depth, and the indent width. Each setting
applies the moment it changes, with nothing to save, so trying one costs
nothing. These settings are grouped by what a person wants to change, the
look of code, how the editor behaves, and how results appear, rather than
by how the program is built.

### Colors and contrast

The palette moved from warm grays to cool ink and paper taken from the app
icon, a deep blue gray for the window, a white or near black page for code,
the existing blue for actions, and the icon's orange for R at work. Light
mode remains the default, since dark text on a light ground is read and
proofread more accurately (Piepenbrock et al. 2013; Piepenbrock, Mayr, and
Buchner 2014). Dark mode is one click away for people who prefer it.
Aesthetic quality affects how usable an interface is perceived to be
(Tractinsky, Katz, and Ikar 2000), which is a reason to care about it, not a
replacement for testing.

Every color pairing passes WCAG 2.2 AA in all three appearances and all five
color vision palettes, checked by `npm run audit:contrast`. Every pointer
target is at least 44 pixels tall, above the 24 pixels WCAG 2.2 AA asks for.

### Smaller additions

These were added at the same time: warnings in plain
words, undo for a run, safety for unsaved work, why a run is slow, help
with failed package installs, a map of a Shiny app, a live report
preview, editing data and plots without code, a focus mode, a Paper
appearance, progress for long runs, quick help on hover, and ready made
snippets. Each was judged against the rest of the app before any code was
written, with one rule above the others: a new ability should live in a
place that already exists, never in a new panel, toolbar, or window.
Every extra control competes for attention with the work (Tuch et al.
2009), and the people this app is for are often new to R.

Here is where each one went, and why.

- Warnings are shown the way errors already are: a short headline, a
  plain reason, a fix where there is one, and R's own words one press
  away. They use the warning color and a different shape from errors, so
  a warning never reads as a failure. A failed package install is one of
  these warnings, so its explanation, with the exact command for the
  missing system library on this computer, is the same component, not a
  second one.
- Undo the last run puts back the objects the last run changed. One
  press of Run is one undo, so undoing a Run file undoes the whole file,
  matching how people think of their own actions (Norman 2013). Before
  each run, R keeps a reference to every object, which costs almost no
  memory, since R copies an object only when it changes. Undo sits on the
  stage beside Pin, where the result of that run is, and in the Run menu.
  It says exactly what it put back, and it says when it cannot help, such
  as after a run that wrote a file. There is one level and no redo, since
  running the line again is the redo. Editing data or plot labels from
  the canvas makes an ordinary run, so the same Undo covers those too.
- You do not have to ask why a run is slow. R samples where it
  spends its time during every run, and when a run takes two seconds or
  more, the time already shown on its result opens a short list of where
  the time went. Profiling during the run means the answer is there when
  it is wanted, without running slow code a second time.
- A progress bar appears only after a run has taken a second, the point at
  which people start to wonder whether anything is happening (Card,
  Robertson, and Mackinlay 1991). It is a slim bar across the top of the
  stage with the line and the time so far, and Stop beside it. With motion
  reduced, the bar holds still and only the time counts up.
- Unsaved work is kept as it is typed, so a crash or a forced quit
  never loses it, and it comes back as unsaved changes the next time,
  with a note saying so. Saving files automatically is a choice in
  Settings, off by default, since writing to someone's files without
  asking changes what Save means. When R itself stops, the banner that
  offers Restart R also offers to restart and run the script again up to
  the last line that ran, so objects come back in one press.
- Quick help shows when the pointer rests on a function: its title,
  the package it is from, and how it is called, read from R's own help.
  Resting on an object shows what it is, such as a data frame with its
  size. F1 still opens the whole page. The note stays while the pointer is
  over it and Escape closes it, as WCAG 1.4.13 asks of content on hover.
- Snippets are in the search everyone already uses, under Insert, such
  as Insert: read a CSV file, rather than in a gallery of their own. Each
  goes in at the cursor with its blanks selected in turn by Tab. People
  learning to program reuse working examples more than they write from
  nothing (Brandt et al. 2009), so the empty script says the snippets are
  there.
- Focus mode hides the sidebar, the objects row, the timeline, and the
  prompt, leaving the script and the result on the stage. A small Leave
  focus button stays on screen, so the way back is always visible, and
  the same shortcut toggles it.
- Paper joins Light and Dark as an appearance: a warm, low glare page
  for long reading, with every color pairing held to the same contrast
  audit as the others. Matching the system's light or dark setting was
  already the default.
- Editing data happens in the column details beside the data viewer,
  which already sort and plot. Keep only some rows, Rename, and Remove
  this column each write one line of base R into the script and run it,
  so the change is part of the analysis and runs again with it, as data
  tools that write code have shown to work (Kandel et al. 2011).
- Editing a plot uses the bar under each plot on the stage, which
  already has Full size and Export. Edit labels changes the title and the
  axis labels in the line that drew the plot, for base R plots and for
  ggplot2, and runs it again. The change is in the code, so it is never
  lost when the script runs from the top.
- The reactive map is part of the App sheet, which now appears for
  any Shiny app in front, not only a running one. Inputs, reactives, and
  outputs sit in three columns joined by lines, and choosing any of them
  highlights what it depends on and what depends on it. The same facts
  are listed as text for screen readers.
- The live report preview renders again after each save once a
  report has been rendered, with a switch on the Report sheet to turn it
  off, and the preview opens at the section the cursor is in.

Two ideas were narrowed on purpose. Plot colors are offered only for
base R plots, since a ggplot2 color is often mapped from the data and a
single color would change what the plot shows. Undo restores objects but
not files or a database, and it says so rather than pretend.

### Later additions

These came later, each placed where people already look. They cover finding text in every file, renaming,
tidying code, explaining a line without the assistant, gentle hints about
common pitfalls, results that last between sessions, turning a session
into a report, checking a script runs from scratch, plots styled like the
app, citations, a guided first project, a compact layout, and a reading
width for reports. The rule from the first list held: each lives in a
place that already exists, and the few new surfaces appear only while
they are in use.

- Find in all files (Shift Command F, as in RStudio) is a dialog like
  the search. Type, and every line that matches is listed under its file,
  with the match marked. A press opens the file at that line. Searching
  more than one file is the step people take when they cannot remember
  where they wrote something, so it searches every open file and every
  script in the project, open or not, and an open file is searched as it
  stands, unsaved changes included.
- Rename (F2, as in most editors) renames an object everywhere it
  appears in the script, and only where it is that object: not inside
  text, comments, a column after a dollar sign, or an argument name. It
  lists every place before changing anything, and the change is one edit,
  so Command Z takes all of it back.
- Tidy code (Shift Command A, as in RStudio) reformats the selection,
  or the file, with the styler package, the tidyverse style many courses
  teach, as one undoable edit. When styler is missing it offers the
  install, as a missing package does anywhere else.
- "What does this code do?" (Option Command E) now works without the
  assistant, from the Edit menu. It reads the line itself: each function
  in the order R finishes it, with the title of its help page, such as
  "read.csv(): Data Input", and then where the result is stored. When the
  assistant is set up, the same note has a button to ask it for more. The
  Assistant menu keeps its own entry, without the shortcut, so the
  shortcut always gives the answer that needs nothing installed.
- Gentle hints point out a few pitfalls that are not errors: T and F
  for TRUE and FALSE, setwd() inside a project, rm(list = ls()) at the
  top of a script, 1:length(x), and x == NA. They use a dotted underline
  in the muted text color, quieter than the warning color of a likely
  mistake, and the note with a Change button shows in the same quick help
  that shows on hover, so nothing new appears on screen. They can be
  turned off in Settings, under Editor.
- Results now last between sessions. The latest sixty outputs of saved files are
  kept on this computer, in the window's own storage, and come back,
  marked as from last time, when their file opens again, so a plot from
  yesterday is still there to look at. A result goes back beside its line
  only when the line still holds the same code. The timeline's Clear
  removes them, and Settings can turn this off.
- Save results as a report turns the session's results into a draft
  Quarto document, each script statement that made an output becoming a
  chunk, in order, opened as a new file to edit and render.
- Check it runs from scratch, in the Run menu, runs the script in a
  fresh R of its own, with no saved workspace or startup files, one
  statement at a time, without touching the session.
  It names the first line that fails there, which is almost always a line
  that depended on something made at the prompt, or by a line since
  deleted. The result shows above the script, with Go to line.
- Plots styled like the app is a choice under Results: base R and
  ggplot2 plots get the app's page, text, and grid colors, light or dark
  to match, on top of the palette they already share. It is off by
  default, since a plot saved from the session then carries the app's
  look too. Turning it off removes only the app's own hooks.
- Insert citation, in a report, finds a work by its DOI
  or by words from its title, writes it to references.bib beside the
  report, adds the bibliography to the header if it is missing, and puts
  the citation at the cursor.
- A guided first project walks through one real piece of work, from
  reading data to a written report, on the person's own data. A small
  card at the foot of the sidebar says what to do next and notices when
  it is done, however it was done, rather than asking the person to press
  Next, so they learn by doing the work itself (Carroll and Rosson 1987).
  Each step has one button that shows a way, using the part of the app
  made for it. It starts from Help, the opening screen, and the search,
  and can be left at any step.
- Compact spacing is a choice under Appearance for small screens. It
  tightens padding and gaps only. Every control keeps the app's 44 pixel
  target, well above the 24 that WCAG 2.2 asks for, since a smaller
  target is slower to hit (Fitts 1954).
- Reading width keeps the lines of a report's writing to a
  comfortable length, about 80 characters, on wide screens, where very
  long lines are slower to read.

## What the evidence does not settle

- Hiding result actions until hover makes them cost nothing to look at,
  but a person has to know they are there. Keyboard focus shows them too,
  and the same actions are in the menus, but whether newcomers find them
  without being told has not been measured.
- The model list reflects models available in late 2026. Models change
  quickly, and the pros and cons are judgments from their published
  descriptions and general use, not from a study of R help specifically.
- Whether people check an assistant's code more carefully when the app
  says R can read it, or less, is an open question. The label says only
  that the code parses, not that it is right, and the wording says so.
- Moving R to the script's folder before each run is a judgment call. It
  matches what novices expect and is announced each time, but someone who
  calls `setwd()` themselves will see R move again when they next run code
  from a script in another folder. If that proves confusing in use, the
  move can become a setting.
- The research on visual complexity mostly studied web pages, not code
  editors. The direction holds, fewer and quieter elements, but the size of
  the effect for an IDE is not measured.
- Rendering in a separate R keeps reports honest but surprises people who
  expect console objects to be there. The failure message names the
  cause, but whether an option to render in the console's session would
  help newcomers more than it would hurt the reports they share is open.
- Only one Shiny app runs at a time, as in RStudio's viewer, which keeps
  the pane simple and leaves no app running unnoticed. People building two
  apps that talk to each other would need more, and how common that is
  among the people this app is for is not known.
- The stage shows one output at a time, which suits a plot or a table
  but not reading several short printed results in a row; the timeline
  covers that one press at a time. Whether people want a mode that shows
  the session's printed text as one continuous page, or a filter on the
  timeline, plots only for example, is open. A separate window for
  outputs, for a second display, was one of the sketches and is not
  built yet. A help page and a plot are also not on screen together,
  since R help is a sheet over the canvas.
- The sheet buttons on the canvas are icons with names on pointing and
  for screen readers, not words, to leave the bar for the objects.
  Labeled icons are found faster than bare ones (Wiedenbeck 1999), so
  whether these five are learned quickly enough is worth watching.
- The first run of the built app, by someone who was not its author,
  found the problems corrected above within minutes: a plot that
  could fill the window, an inspector that could crowd out the script,
  no way back to the opening screen without closing everything, a
  right side that hid plots behind a rail of tabs, and, after that was
  fixed, a layout that still looked like RStudio. That
  is a sample of one, not a study, and it argues for more of exactly this
  before the next design rather than less. A short usability study with
  new and experienced R users, observed while
  they write and debug a script, is the next step.

## References

Bartram, L., Ware, C., and Calvert, T. (2003). Moticons: Detection,
distraction and task. *International Journal of Human-Computer Studies,
58*(5), 515-545.

Becker, B. A., Denny, P., Pettit, R., Bouchard, D., Bouvier, D. J.,
Harrington, B., Kamil, A., Karkare, A., McDonald, C., Osera, P.-M.,
Pearce, J. L., and Prather, J. (2019). Compiler error messages considered
unhelpful: The landscape of text-based programming error message research.
In *Proceedings of the Working Group Reports on Innovation and Technology
in Computer Science Education* (pp. 177-210). ACM.

Becker, B. A., Glanville, G., Iwashima, R., McDonnell, C., Goslin, K., and
Mooney, C. (2016). Effective compiler error message enhancement for novice <!-- standards: title of a cited work -->
programming students. *Computer Science Education, 26*(2-3), 148-175.

Brandt, J., Guo, P. J., Lewenstein, J., Dontcheva, M., and Klemmer, S. R.
(2009). Two studies of opportunistic programming: Interleaving web
foraging, learning, and writing code. In *Proceedings of the SIGCHI
Conference on Human Factors in Computing Systems* (pp. 1589-1598). ACM.

Card, S. K., Robertson, G. G., and Mackinlay, J. D. (1991). The
information visualizer, an information workspace. In *Proceedings of the
SIGCHI Conference on Human Factors in Computing Systems* (pp. 181-186).
ACM.

Card, S. K., Mackinlay, J. D., and Shneiderman, B. (Eds.). (1999).
*Readings in Information Visualization: Using Vision to Think*. Morgan
Kaufmann.

Carroll, J. M., and Rosson, M. B. (1987). Paradox of the active user. In
J. M. Carroll (Ed.), *Interfacing Thought: Cognitive Aspects of
Human-Computer Interaction* (pp. 80-111). MIT Press.

Chattopadhyay, S., Prasad, I., Henley, A. Z., Sarma, A., and Barik, T.
(2020). What's wrong with computational notebooks? Pain points, needs, and
design opportunities. In *Proceedings of the 2020 CHI Conference on Human
Factors in Computing Systems*. ACM.

Denny, P., Prather, J., Becker, B. A., Mooney, C., Homer, J., Albrecht, Z.
C., and Powell, G. B. (2021). On designing programming error messages for
novices: Readability and its constituent factors. In *Proceedings of the
2021 CHI Conference on Human Factors in Computing Systems*. ACM.

Findlater, L., and McGrenere, J. (2004). A comparison of static, adaptive,
and adaptable menus. In *Proceedings of the SIGCHI Conference on Human
Factors in Computing Systems*, 89 to 96. ACM.

Fitts, P. M. (1954). The information capacity of the human motor system in
controlling the amplitude of movement. *Journal of Experimental Psychology,
47*(6), 381-391.

Ginns, P. (2006). Integrating information: A meta-analysis of the spatial
contiguity and temporal contiguity effects. *Learning and Instruction,
16*(6), 511-525.

Goddard, K., Roudsari, A., and Wyatt, J. C. (2012). Automation bias: A
systematic review of frequency, effect mediators, and mitigators. *Journal
of the American Medical Informatics Association, 19*(1), 121-127.

Hick, W. E. (1952). On the rate of gain of information. *Quarterly Journal
of Experimental Psychology, 4*(1), 11-26.

Hyman, R. (1953). Stimulus information as a determinant of reaction time.
*Journal of Experimental Psychology, 45*(3), 188-196.

Iyengar, S. S., and Lepper, M. R. (2000). When choice is demotivating: Can
one desire too much of a good thing? *Journal of Personality and Social
Psychology, 79*(6), 995-1006.

Kazemitabaar, M., Chow, J., Ma, C. K. T., Ericson, B. J., Weintrop, D., and
Grossman, T. (2023). Studying the effect of AI code generators on
supporting novice learners in introductory programming. In *Proceedings of
the 2023 CHI Conference on Human Factors in Computing Systems*. ACM.

Kandel, S., Paepcke, A., Hellerstein, J., and Heer, J. (2011). Wrangler:
Interactive visual specification of data transformation scripts. In
*Proceedings of the SIGCHI Conference on Human Factors in Computing
Systems* (pp. 3363-3372). ACM.

Kandel, S., Parikh, R., Paepcke, A., Hellerstein, J. M., and Heer, J.
(2012). Profiler: Integrated statistical analysis and visualization for data
quality assessment. In *Proceedings of the International Working Conference
on Advanced Visual Interfaces* (pp. 547-554). ACM.

Kery, M. B., Radensky, M., Arya, M., John, B. E., and Myers, B. A. (2018).
The story in the notebook: Exploratory data science using a literate
programming tool. In *Proceedings of the 2018 CHI Conference on Human
Factors in Computing Systems*. ACM.

Lane, D. M., Napier, H. A., Peres, S. C., and Sándor, A. (2005). Hidden
costs of graphical user interfaces: Failure to make the transition from
menus and icon toolbars to keyboard shortcuts. *International Journal of
Human-Computer Interaction, 18*(2), 133-144.

Lau, S., Drosos, I., Markel, J. M., and Guo, P. J. (2020). The design space
of computational notebooks: An analysis of 60 systems in academia and
industry. In *2020 IEEE Symposium on Visual Languages and Human-Centric
Computing (VL/HCC)*.

Lederer, S., Hong, J. I., Dey, A. K., and Landay, J. A. (2004). Personal
privacy through understanding and action: Five pitfalls for designers.
*Personal and Ubiquitous Computing, 8*(6), 440-454.

Leinonen, J., Hellas, A., Sarsa, S., Reeves, B., Denny, P., Prather, J., and
Becker, B. A. (2023). Using large language models to enhance programming <!-- standards: title of a cited work -->
error messages. In *Proceedings of the 54th ACM Technical Symposium on
Computer Science Education*. ACM.

Legge, G. E., and Bigelow, C. A. (2011). Does print size matter for
reading? A review of findings from vision science and typography.
*Journal of Vision*, 11(5), 8.

Lindgaard, G., Fernandes, G., Dudek, C., and Brown, J. (2006). Attention web
designers: You have 50 milliseconds to make a good first impression!
*Behaviour and Information Technology, 25*(2), 115-126. <!-- standards: journal title -->

Marceau, G., Fisler, K., and Krishnamurthi, S. (2011). Measuring the
effectiveness of error messages designed for novice programmers. In
*Proceedings of the 42nd ACM Technical Symposium on Computer Science
Education* (pp. 499-504). ACM.

Mayer, R. E. (2009). *Multimedia Learning* (2nd ed.). Cambridge University
Press.

McGrenere, J., Baecker, R. M., and Booth, K. S. (2002). An evaluation of a
multiple interface design solution for bloated software. In *Proceedings of
the SIGCHI Conference on Human Factors in Computing Systems* (pp. 164-170).
ACM.

McGrenere, J., and Moore, G. (2000). Are we all in the same "bloat"? In
*Proceedings of Graphics Interface 2000* (pp. 187-196).

Nielsen, J. (1994). Enhancing the explanatory power of usability <!-- standards: title of a cited work -->
heuristics. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems* (pp. 152-158). ACM.

Norman, D. A. (2013). *The Design of Everyday Things* (Revised and
expanded edition). Basic Books.

Palmer, S. E. (1992). Common region: A new principle of perceptual
grouping. *Cognitive Psychology, 24*(3), 436-447.

Piepenbrock, C., Mayr, S., and Buchner, A. (2014). Positive display
polarity is particularly advantageous for small character sizes:
Implications for display design. *Human Factors, 56*(5), 942-951.

Piepenbrock, C., Mayr, S., Mund, I., and Buchner, A. (2013). Positive
display polarity is advantageous for both younger and older adults.
*Ergonomics, 56*(7), 1116-1124.

Pimentel, J. F., Murta, L., Braganholo, V., and Freire, J. (2019). A
large-scale study about quality and reproducibility of Jupyter notebooks.
In *2019 IEEE/ACM 16th International Conference on Mining Software
Repositories (MSR)* (pp. 507-517). IEEE.

Reinecke, K., Yeh, T., Miratrix, L., Mardiko, R., Zhao, Y., Liu, J., and
Gajos, K. Z. (2013). Predicting users' first impressions of website
aesthetics with a quantification of perceived visual complexity and
colorfulness. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems* (pp. 2049-2058). ACM.

Rello, L., Pielot, M., and Marcos, M.-C. (2016). Make it big! The effect <!-- standards: title of a cited work -->
of font size and line spacing on online readability. In *Proceedings of
the 2016 CHI Conference on Human Factors in Computing Systems*, 3637 to
3648. ACM.

Rosenholtz, R., Li, Y., and Nakano, L. (2007). Measuring visual clutter.
*Journal of Vision, 7*(2), 17.

Rule, A., Tabard, A., and Hollan, J. D. (2018). Exploration and explanation
in computational notebooks. In *Proceedings of the 2018 CHI Conference on
Human Factors in Computing Systems*. ACM.

Saltzer, J. H., and Schroeder, M. D. (1975). The protection of information
in computer systems. *Proceedings of the IEEE, 63*(9), 1278-1308.

Sandve, G. K., Nekrutenko, A., Taylor, J., and Hovig, E. (2013). Ten simple
rules for reproducible computational research. *PLOS Computational Biology,
9*(10), e1003285.

Shneiderman, B. (1996). The eyes have it: A task by data type taxonomy for
information visualizations. In *Proceedings of the 1996 IEEE Symposium on
Visual Languages* (pp. 336-343). IEEE.

Shneiderman, B. (2003). Promoting universal usability with multi-layer
interface design. In *Proceedings of the 2003 Conference on Universal
Usability* (pp. 1-8). ACM.

Singley, M. K., and Anderson, J. R. (1989). *The Transfer of Cognitive
Skill*. Harvard University Press.

Sweller, J. (1988). Cognitive load during problem solving: Effects on
learning. *Cognitive Science, 12*(2), 257-285.

Tanimoto, S. L. (2013). A perspective on the evolution of live programming.
In *Proceedings of the 1st International Workshop on Live Programming
(LIVE)* (pp. 31-34). IEEE.

Tractinsky, N., Katz, A. S., and Ikar, D. (2000). What is beautiful is
usable. *Interacting with Computers, 13*(2), 127-145.

Tuch, A. N., Bargas-Avila, J. A., Opwis, K., and Wilhelm, F. H. (2009).
Visual complexity of websites: Effects on users' experience, physiology,
performance, and memory. *International Journal of Human-Computer Studies,
67*(9), 703-715.

Tuch, A. N., Presslaber, E. E., Stöcklin, M., Opwis, K., and Bargas-Avila,
J. A. (2012). The role of visual complexity and prototypicality regarding
first impression of websites: Working towards understanding aesthetic <!-- standards: title of a cited work -->
judgments. *International Journal of Human-Computer Studies, 70*(11),
794-811.

Tufte, E. R. (2006). *Beautiful Evidence*. Graphics Press.

Wiedenbeck, S. (1999). The use of icons and labels in an end user
application program: An empirical study of learning and retention.
*Behaviour and Information Technology, 18*(2), 68-82. <!-- standards: journal title -->
