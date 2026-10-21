# Design rationale

This page records why the interface looks and behaves the way it does, and
which evidence each decision rests on. It covers the sixth design. The
second replaced folder access with individual scripts and cleared the
workspace of clutter; the third brought projects back without folder
access, added the data viewer and plot export, and had R ready the moment
the app opens. The fourth rebuilt each result as a card with a title bar,
arranged the window the way RStudio does, added code completion, R help,
packages, history, and data import, and stopped a reload of the window from
restarting R. The fifth takes the chrome back off the results, quiets the
rest of the window, rewrites errors so they say where the code went wrong,
and adds an optional assistant that runs a language model on the person's
own computer. The sixth makes the text larger and adds settings for code
type and the editor, makes the result cards optional, lets a copy take in
as many results as are selected, sets the four areas as panels on a
workbench rather than a grid of boxes, and renders Quarto and R Markdown
reports with a preview beside the code.

## What changed and why

### A calmer window

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

### Scripts and projects, never whole folders

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

R follows the script. It starts in the folder of the first script opened,
and when code runs from a script in another folder, R moves there first and
the console says so. A path such as `"data.csv"` then means the file beside
the script, which is what a new R user expects. Making the change visible
every time keeps it from being a silent surprise for someone who did set a
working folder on purpose (Nielsen 1994, visibility of system status).
Inside a project, R stays in the project folder, as RStudio does.

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

### Labels over bare icons

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
why the app offers four placements rather than one. The fourth, In the
console, is the traditional one: results print in the console under an
echo of the code, as in R itself. The script still shows a check beside
each line that ran and underlines the part of a line that failed, so the
link between code and outcome is kept even there.

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

### Cards are a choice, not a requirement

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

### Errors in plain words, at the exact spot

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

### Live results, kept safe

Live programming shortens the gap between editing and seeing the effect
(Tanimoto 2013). Results that update as you type remain an option rather
than the default, and anything that writes files, installs packages, or
changes the session never runs that way.

### Arranged as RStudio arranges it, on a workbench

Most people who come to this app will have used RStudio, often for years.
A layout close to the one people expect is judged more favorably at first
sight (Tuch et al. 2012), and skill carries over to a new tool in
proportion to what the two have in common (Singley and Anderson 1989). The
window therefore follows RStudio's four areas: the script above the
console on the left, Environment and History at the top right, and Plots,
Help, and Packages at the bottom right. RStudio's shortcuts work as they do
there: Control and a number moves to a pane, Shift Command M types a pipe,
Option minus an assignment arrow, Shift Command R a new section, and F1
opens help for the name at the cursor. The right column's width, the split
between its panes, the console's height, and the height of its typing box
can each be dragged or moved with the arrow keys, following the WAI-ARIA
window splitter pattern, and each size is remembered.

Where this app departs from RStudio, it does so on purpose. Results sit
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

The typing box in the console is now a small code editor, so typed R is
colored as in the script and brackets match. In both places, suggestions
come from the completion engine R ships for its own console, the one
RStudio builds on, so they know the objects in the session, a function's
arguments inside its parentheses, and a data frame's columns after a dollar
sign. They appear after three characters, as in RStudio, and Tab asks at
any point or takes the highlighted suggestion.

Help pages are R's own. Typing ?mean in the console, searching in the Help
pane, or pressing F1 shows the page in the pane, and links between pages
open there too. The HTML that R produces is rebuilt from an allowlist of
plain tags before it is shown, so a package's help can never run code or
reach the network. A side effect is that help follows the app's text size
and appearance. The Packages pane lists what is installed, and attaching
or detaching a package runs the matching line in the console, where it can
be seen and copied.

### Importing data

The Import Data dialog follows RStudio's: choose a file, see its first rows
as R reads them, adjust the separator, decimal mark, missing value markers,
rows to skip, or the sheet of a workbook, and see the exact code before it
runs. For a text file, R reads the first lines and the dialog guesses the
separator and decimal mark, so a semicolon file saved by a European
spreadsheet previews correctly at once. The code runs in the console and,
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

### Starting from nothing

The opening screen offers one main way in, a new project, with three
smaller ones beside it, next to the projects and scripts opened before.
Recent work is recognized rather than recalled (Nielsen 1994).

R starts with the app rather than with the first file, so by the time
anything is open it is ready, and the opening screen says so in one line.
Waiting for R after choosing a file was a delay at the exact moment the
person wanted to begin. When a project then opens, an R that has not run
anything yet moves into the project folder instead of restarting, so the
person never sees R start twice.

### The console as a drawer

The second design folded the console to one line. In use the input was too
small to write a multi-line statement in comfortably. The console is now a
drawer under the editor whose height the person sets by dragging its edge,
or by focusing the edge and pressing the arrow keys, and the height is
remembered. The typing box has an edge of its own, so it can be made as
tall as a long statement needs.
The edge is a standard separator with its value exposed, so screen readers
announce the height as it changes.

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

PDF is made with Typst, a typesetting program that comes inside Quarto,
rather than LaTeX. LaTeX is a separate install, several gigabytes in its
full form, and a common place for newcomers to give up before their first
PDF. A document whose
header asks for LaTeX still gets it when rendered as written, and if
LaTeX is missing the message offers the Typst PDF instead of an install.

A chunk that fails is explained by the same rules as an error in the
console, so the wording, the plain headline, and the one thing to try are
the same everywhere. knitr names the lines of the chunk that stopped, the
rules find the part of that chunk that failed, and the editor underlines
it, so the person goes straight from the message to the line.

### Text people can read

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

### Look and feel

The palette moved from warm grays to cool ink and paper taken from the app
icon, a deep blue gray for the window, a white or near black page for code,
the existing blue for actions, and the icon's orange for R at work. Light
mode remains the default, since dark text on a light ground is read and
proofread more accurately (Piepenbrock et al. 2013; Piepenbrock, Mayr, and
Buchner 2014). Dark mode is one click away for people who prefer it.
Aesthetic quality affects how usable an interface is perceived to be
(Tractinsky, Katz, and Ikar 2000), which is a reason to care about it, not a
replacement for testing.

Every color pairing passes WCAG 2.2 AA in both appearances and all five
color vision palettes, checked by `npm run audit:contrast`. Every pointer
target is at least 44 pixels tall, above the 24 pixels WCAG 2.2 AA asks for.

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
- None of these decisions have been tested with people using this app.
  A short usability study with new and experienced R users, observed while
  they write and debug a script, is the next step.

## References

Becker, B. A., Denny, P., Pettit, R., Bouchard, D., Bouvier, D. J.,
Harrington, B., Kamil, A., Karkare, A., McDonald, C., Osera, P.-M.,
Pearce, J. L., and Prather, J. (2019). Compiler error messages considered
unhelpful: The landscape of text-based programming error message research.
In *Proceedings of the Working Group Reports on Innovation and Technology
in Computer Science Education* (pp. 177-210). ACM.

Becker, B. A., Glanville, G., Iwashima, R., McDonnell, C., Goslin, K., and
Mooney, C. (2016). Effective compiler error message enhancement for novice <!-- standards: title of a cited work -->
programming students. *Computer Science Education, 26*(2-3), 148-175.

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

McGrenere, J., Baecker, R. M., and Booth, K. S. (2002). An evaluation of a
multiple interface design solution for bloated software. In *Proceedings of
the SIGCHI Conference on Human Factors in Computing Systems* (pp. 164-170).
ACM.

McGrenere, J., and Moore, G. (2000). Are we all in the same "bloat"? In
*Proceedings of Graphics Interface 2000* (pp. 187-196).

Nielsen, J. (1994). Enhancing the explanatory power of usability <!-- standards: title of a cited work -->
heuristics. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems* (pp. 152-158). ACM.

Palmer, S. E. (1992). Common region: A new principle of perceptual
grouping. *Cognitive Psychology, 24*(3), 436-447.

Piepenbrock, C., Mayr, S., and Buchner, A. (2014). Positive display
polarity is particularly advantageous for small character sizes:
Implications for display design. *Human Factors, 56*(5), 942-951.

Piepenbrock, C., Mayr, S., Mund, I., and Buchner, A. (2013). Positive
display polarity is advantageous for both younger and older adults.
*Ergonomics, 56*(7), 1116-1124.

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
