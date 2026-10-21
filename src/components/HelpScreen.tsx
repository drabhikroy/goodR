// The app's own help, written around the questions people have while they
// work: how to run code, where results go, and what to do when something
// goes wrong. It is laid out in two parts. On the left, a search box and
// the topics, grouped by what someone is trying to do. On the right, one
// topic at a time, with buttons that point at the parts of the app it is
// about. It opens on Start here, which has the tour, the examples, and a
// small map of the window where each part can be pressed to find it.
//
// Help shows over the workspace without closing anything, as Home does, so
// it can be read and closed again with everything left as it was. R's own
// documentation is a different thing, in the R help sheet on the canvas.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hideHelpScreen, openExamples, openUrl, showMe, startTour } from "../lib/app";
import { startGuide } from "../lib/firstProject";
import { TARGETS, type GuideTarget } from "../lib/guide";
import { COMMANDS, keyLabel } from "../lib/commands";
import { useStore } from "../lib/store";
import { ArrowIcon } from "./Icons";

type Topic = {
  id: string;
  group: string;
  label: string;
  /** One sentence under the title, saying what the topic answers. */
  summary: string;
  /** Extra words the search box matches, beyond the label and summary. */
  words?: string;
  body: () => ReactNode;
  show?: GuideTarget[];
};

/** Buttons that take the reader straight to the parts a topic is about,
 * each marked on screen with widening rings. */
function ShowMe({ targets }: { targets: GuideTarget[] }) {
  return (
    <div className="show-me" role="group" aria-label="Show me in the app">
      <span className="show-me-label">Show me</span>
      {targets.map((target) => (
        <button key={target} type="button" className="show-me-link" onClick={() => showMe(target)}>
          <span className="show-me-dot" aria-hidden="true" />
          {TARGETS[target].label}
        </button>
      ))}
    </div>
  );
}

// Shortcut sections in the order the work goes: running, then the rest.
const SHORTCUT_SECTIONS = ["Run", "File", "Edit", "View", "Window", "Help"];

/** Every command that has a shortcut, from the same list the palette and
 * the menus use, so this table can never disagree with them. */
function Shortcuts() {
  return (
    <div className="help-shortcuts">
      {SHORTCUT_SECTIONS.map((section) => {
        const rows = COMMANDS.filter((command) => command.section === section && command.keys);
        if (!rows.length) return null;
        return (
          <section key={section}>
            <h3>{section}</h3>
            <dl>
              {rows.map((command) => (
                <div key={command.id}>
                  <dt>{command.title}</dt>
                  <dd>
                    <kbd>{keyLabel(command.keys ?? "")}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function ExamplesButton() {
  return (
    <div className="help-actions">
      <button type="button" className="button" onClick={openExamples}>
        Open the examples
      </button>
    </div>
  );
}

/** A small drawing of the window. Each part is a button that closes Help
 * and points at that part, so finding something takes one press. */
function WindowMap() {
  const part = (target: GuideTarget, className: string, text: string) => (
    <button type="button" className={`map-part ${className}`} aria-label={TARGETS[target].label} onClick={() => showMe(target)}>
      <span className="show-me-dot" aria-hidden="true" />
      {text}
    </button>
  );
  return (
    <div className="window-map" role="group" aria-label="Show me in the app">
      <div className="map-bar">
        {part("home", "map-home", "Home")}
        {part("session", "map-session", "Projects")}
        {part("search", "map-search", "Search")}
      </div>
      <div className="map-body">
        <div className="map-left">
          {part("run", "map-run", "Run")}
          <div className="map-script" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {part("prompt", "map-prompt", "Prompt")}
        </div>
        <div className="map-right">
          {part("objects", "map-objects", "Objects")}
          {part("stage", "map-stage", "Stage")}
          {part("timeline", "map-timeline", "Earlier results")}
        </div>
      </div>
    </div>
  );
}

function StartHere({ go }: { go: (id: string) => void }) {
  return (
    <>
      <div className="start-cards">
        <button type="button" className="start-card" onClick={startTour}>
          <span className="start-card-title">Take the tour</span>
          <span className="start-card-hint">Eleven short steps, about two minutes</span>
        </button>
        <button type="button" className="start-card" onClick={openExamples}>
          <span className="start-card-title">Open the examples</span>
          <span className="start-card-hint">Scripts, reports, and Shiny apps built on real data, from the night sky to rocket launches</span>
        </button>
        <button type="button" className="start-card" onClick={startGuide}>
          <span className="start-card-title">Do a first project</span>
          <span className="start-card-hint">Five steps with your own data, from a file to a report</span>
        </button>
      </div>
      <h3>Find your way around</h3>
      <p>Press any part of this drawing and Help will close and point it out in the app.</p>
      <WindowMap />
      <h3>Common questions</h3>
      <ul className="help-questions">
        {[
          ["run", "How do I run a line?"],
          ["canvas", "Where did my plot go?"],
          ["wrong", "Something failed. What now?"],
          ["undo", "How do I undo a run?"],
          ["shiny", "Why is my Shiny app not working?"],
          ["packages", "How do I install or update packages?"],
        ].map(([id, question]) => (
          <li key={id}>
            <button type="button" className="link-button" onClick={() => go(id)}>
              {question}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Each topic explains what a part of the app is for and how it behaves,
// rather than repeating labels that are already on screen. The groups
// follow the order people meet things: starting, writing, making, fixing.
const TOPICS: Topic[] = [
  {
    id: "start",
    group: "Get started",
    label: "Start here",
    summary: "Where to begin: the tour, the examples, and a first project.",
    words: "tour examples map welcome first project guide steps",
    body: () => null,
  },
  {
    id: "run",
    group: "Writing and running",
    show: ["run", "results"],
    label: "Running code",
    summary: "Run a line, a selection, a chunk, or the whole file.",
    words: "execute command enter line file stop slow progress time snippet insert ready made",
    body: () => (
      <>
        <p>
          Put the cursor on a line and press <kbd>{keyLabel("⌘↩")}</kbd>. The whole statement runs, even if it spans several lines, and the cursor moves on to the next one. Keep pressing to walk through your
          script. To run just part of a line, select it first.
        </p>
        <p>
          <kbd>{keyLabel("⇧⌘↩")}</kbd> runs the whole file and moves the cursor to its end, as running a section or chunk moves it to the end of that part. If a line fails, it stops there, so nothing after it runs on bad data. <kbd>{keyLabel("⌘.")}</kbd> stops whatever is running.
        </p>
        <p>
          The Run button above the script does the same. Its arrow lets you pick a line, the chunk or section you are in, or the whole file, and it can remember your choice for each file. In a script with
          sections, the name at the top left of the script says which section the cursor is in, and its menu jumps to another.
        </p>
        <p>A line that runs but prints nothing, like an assignment, gets a small check mark in the margin.</p>
        <p>
          If a run takes more than a second, a slim bar over the results says which line is running and for how long, with Stop beside it. When it finishes, a run that took two seconds or more says
          how long it took. Press that time to see where it went, function by function, or whether R was mostly waiting, for a download or a large file.
        </p>
        <p>
          Not sure how to start? Press <kbd>{keyLabel("⌘K")}</kbd> and type <strong>insert</strong> for ready made code, such as reading a CSV file, a bar chart, or a t-test. It goes in at the cursor,
          and Tab moves between the parts to fill in.
        </p>
      </>
    ),
  },
  {
    id: "editing",
    group: "Writing and running",
    label: "Changing code",
    summary: "Find in every file, rename, tidy up, and see what a line does.",
    words: "find search all files rename refactor tidy format style styler explain lint hint suggestion spaces as you type",
    body: () => (
      <>
        <p>
          <kbd>{keyLabel("⇧⌘F")}</kbd> finds text in every open file and every script in the project, listed by file. Choose a line to go straight to it.
        </p>
        <p>
          <kbd>F2</kbd> on a name renames it everywhere in the file. Before anything changes, it shows each line that will, and it leaves alone the same word in text, in comments, after a <code>$</code>, and as
          an argument name such as <code>data =</code>.
        </p>
        <p>
          <kbd>{keyLabel("⇧⌘A")}</kbd> tidies the code: spaces around arrows, even indenting, one style throughout. It uses styler, the tidyverse&#8217;s own tool, and offers to install it the first time. It works
          on the selection, the chunk you are in, or the whole script, and one Undo puts it back.
        </p>
        <p>
          As you finish a line and press Return, its spacing is tidied for you: spaces around <code>&lt;-</code> and <code>==</code>, one after each comma, none inside brackets. It only touches the line
          you just finished, never text inside quotes, and <kbd>{keyLabel("⌘Z")}</kbd> puts a line back as you typed it. Settings, under Editor, turns it off.
        </p>
        <p>
          <kbd>{keyLabel("⌥⌘E")}</kbd> says what the code at the cursor does, step by step, in the order R does it, with what each function is for. No assistant is needed. When the assistant is set up, it can
          say more.
        </p>
        <p>
          A dotted line under some code is a suggestion, not an error: a habit that works today and causes trouble later, such as <code>T</code> for <code>TRUE</code> or <code>1:length(x)</code>. Rest the
          pointer on it to see why, and change it with one click. Settings, under Editor, turns these off.
        </p>
      </>
    ),
  },
  {
    id: "trace",
    group: "Writing and running",
    label: "Where things came from, and what changed",
    summary: "Trace an object back through the script, and compare a rerun with the last one.",
    words: "lineage trace depend dependency rerun downstream upstream compare difference changed before after",
    body: () => (
      <>
        <p>
          Choose an object on the canvas, or put the cursor on its name, and choose Where did this come from? in the Edit menu. It lists the line that made it and every line that changed it since,
          with the columns each one added. The names it was made from can be traced the same way.
        </p>
        <p>
          It also lists the lines after it that use it, directly or through something made from it. After you fix something early in a script, those are the lines to run again, and one button runs
          them.
        </p>
        <p>
          When you run a line again, its result says what changed since last time: numbers that moved, printed lines that came or went, objects that grew or shrank, and, for a plot, a slider to wipe
          between the old one and the new.
        </p>
      </>
    ),
  },
  {
    id: "prompt",
    group: "Writing and running",
    show: ["prompt"],
    label: "Typing R directly",
    summary: "The box under your script, for quick one off commands.",
    words: "console prompt history repl hover quick help",
    body: () => (
      <>
        <p>
          Type any R into the box under the script and press Return. What it prints shows up on the canvas. If the line is not finished yet, it waits for the rest. Shift Return adds a new line without running.
        </p>
        <p>
          Up and Down bring back what you typed before. History has all of it, and you can send any of it back to the prompt or into your script. Tab finishes names for you, and <code>?mean</code> opens the help
          for <code>mean</code>.
        </p>
        <p>If R asks you a question, the box says so and takes your answer.</p>
        <p>Rest the pointer on a function in your script to see what it does and how it is called. Rest it on something you made, such as a data frame, to see what it holds.</p>
      </>
    ),
  },
  {
    id: "canvas",
    group: "Writing and running",
    show: ["stage", "timeline", "objects", "sheets", "canvasToggle"],
    label: "The canvas",
    summary: "Where your plots, tables, and printed results show up.",
    words: "plot output results stage timeline pin export figure",
    body: () => (
      <>
        <p>
          The canvas sits beside your script. Its big area, the stage, shows one result at a time, as large as it fits: a plot, a table you can sort, or printed text. Each new result takes the stage as it
          arrives, and the stage tells you which line made it.
        </p>
        <p>
          Below the stage, the strip of earlier results keeps every result from this session as a small card, under the name of the section of your script it came from. Press one to bring it back, and your
          script jumps to the line that made it. It works the other way too: click a line in your script and its result comes back. Drag the strip&#8217;s top edge to make it taller, and the cards wrap
          into more rows, so more are in view at once. When there are lots of results, the filters at its top narrow them to plots, printed results, or problems. The button with three dots saves them all as a
          report, clears them, or hides the strip.
        </p>
        <p>Pin a result to keep it on the stage while you look at the next one, which is handy for comparing two plots. Full size shows a plot over the whole window, and Export saves it as a file.</p>
        <p>
          Edit labels, under a plot from your script, changes its title and axis labels, and the color of a base R plot. The change is made in the code that drew it, so it stays when the script runs again.
        </p>
        <p>To see only your script and the result, press <kbd>{keyLabel("⌥⌘F")}</kbd> for focus mode. Leave focus, at the top right, brings everything back.</p>
        <p>
          A row of named views runs across the top of the canvas: Canvas, then App or Report when there is one, then Help, Packages, History, and Assistant. The view on show is marked, and
          any other is one press away, so you can always get back to the canvas. Under Canvas, the small cards are the objects you have made; press a data frame to look through it.
        </p>
        <p>
          Prefer results under each line? Choose Under each line in the Results menu above the script. Drag the edge of the canvas to resize it, or hide it with the button at the far right of the title bar.
        </p>
      </>
    ),
  },
  {
    id: "data",
    group: "Writing and running",
    show: ["objects"],
    label: "Data",
    summary: "Bring in a spreadsheet or CSV and look through it.",
    words: "import csv excel spss stata sas data frame viewer table filter rename remove column change",
    body: () => (
      <>
        <p>
          Import data, on the canvas or in the File menu, reads a CSV, a spreadsheet, or a file from SPSS, Stata, or SAS. It works out the separators for you, shows a preview, and adds the line of R that reads
          the file to your script, so it runs again next time.
        </p>
        <p>
          Press a data frame&#8217;s card to open it. Each column shows its type, a small chart of its values, and how many are missing. You can sort by a column or plot it from its header. Big data stays quick,
          because rows load a hundred at a time.
        </p>
        <p>
          Change the data, beside a column, keeps only some rows, renames the column, or removes it. Each change adds one line of R to your script and runs it, so it happens again every time the script runs,
          and Undo the last run takes it back.
        </p>
      </>
    ),
  },
  {
    id: "sessions",
    group: "Writing and running",
    show: ["session", "home", "sidebar"],
    label: "Projects and sessions",
    summary: "Why each project has its own copy of R, and how to switch between them.",
    words: "project rproj restart version working directory folder",
    body: () => (
      <>
        <p>
          Every project gets an R of its own. A script in a project folder, one with an <code>.Rproj</code> file, runs in that project&#8217;s R, starting in the project folder. A script on its own gets its own R
          too, starting in the script&#8217;s folder. So nothing ever runs in the wrong place by accident.
        </p>
        <p>
          The name beside Home, at the top left, is the project or script on show. Its menu lists everything open, with a number when there is more than one, and switches between them, bringing each
          one&#8217;s objects and results along. It also opens recent projects. While R is busy or has stopped, a dot beside the name says so. Restart R is in the Run menu, and the version of
          R is chosen in Settings, under R and packages.
        </p>
        <p>Home, at the left of the title bar, takes you back to the opening screen without closing anything. Continue working, or Escape, brings you right back.</p>
      </>
    ),
  },
  {
    id: "reports",
    group: "Making things",
    label: "Reports",
    summary: "Quarto and R Markdown documents, a chunk at a time.",
    words: "quarto rmarkdown rmd qmd render knit chunk html pdf word preview save latex tinytex typst",
    body: () => (
      <>
        <p>
          Open a Quarto (<code>.qmd</code>) or R Markdown (<code>.Rmd</code>) file and each code chunk gets its own Run chunk button. Results show on the canvas as you go, just like a script.
        </p>
        <p>
          Render makes the finished report, as a web page, a Word document, or a PDF, and shows it on the canvas next to your code. You can open it in your browser from there.
        </p>
        <p>
          A PDF is made with the LaTeX on your computer when you have one, and otherwise with Typst, which needs nothing more. If a document needs LaTeX and you have none, one press
          installs TinyTeX, a small LaTeX the app looks after, and the report renders again when it is ready. Settings, under Reports, lets you choose.
        </p>
        <p>
          Once a report has been rendered, it renders again each time you save, so the preview keeps up with your writing, and it opens at the section you are working on. The switch on the Report sheet
          turns that off.
        </p>
        <p>
          Insert citation, in the Edit menu, cites a paper from its DOI or a few words of its title. It finds the reference, adds it to references.bib beside the document, names that file in the header,
          and puts the citation at the cursor. The list of references appears when the report renders.
        </p>
        <p>
          New report, on the opening screen, starts one for you. The examples include a short Quarto report, a field guide to the night sky, and two R Markdown files to try.
        </p>
        <ExamplesButton />
      </>
    ),
  },
  {
    id: "keeping",
    group: "Making things",
    label: "Keeping and sharing results",
    summary: "Keeping results, making a report from them, and checking a script runs on its own.",
    words: "keep restore last time save report quarto reproducible fresh scratch clean plot theme style match",
    body: () => (
      <>
        <p>
          Results stay on the canvas when you close the app, and come back next time beside the code that made them, marked From last time. The objects behind them are not in R until you run the code
          again. Clear all results, in the menu with three dots above the earlier results, forgets them, and Settings, under Results, turns keeping off.
        </p>
        <p>
          Save as a report, in the same menu, turns the results on the canvas into a Quarto document, one chunk for each result, in the order you made them. Write what they mean between the chunks, then
          render it. The code runs again as it renders, so the report is made fresh from your data.
        </p>
        <p>
          Check it runs from scratch, in the Run menu, runs the whole script in a new R, with nothing left over from your work. A script often works only because of something done by hand, such as an object
          made at the prompt or a package loaded and never written in. If so, the check says which line fails, and why.
        </p>
        <p>Plots match the app, in Settings under Results, gives new plots the app&#8217;s page, text, and grid colors, light or dark, for base R plots and ggplot2 alike.</p>
      </>
    ),
  },
  {
    id: "stats",
    group: "Making things",
    label: "Writing up a test or model",
    summary: "An APA sentence for each result, and its assumptions checked.",
    words: "apa statistics t-test anova regression lm chi-squared correlation assumption normal spread write up report paper",
    body: () => (
      <>
        <p>
          Run a <code>t.test()</code>, <code>wilcox.test()</code>, <code>chisq.test()</code>, <code>cor.test()</code>, <code>aov()</code>, or <code>lm()</code>, and its result gets a write-up: the
          sentence a paper would use, in APA style, such as t(55.31) = 1.92, p = .061, 95% CI [-0.17, 7.57], d = 0.49. Copy write-up puts it on the clipboard.
        </p>
        <p>
          Under it, the test&#8217;s assumptions are checked for you: whether the data are shaped as the test expects, whether groups spread equally, whether a few cases pull a model on their own. A
          line says how many hold. When one does not, it opens by itself and says what to do, such as using a rank based test instead.
        </p>
        <p>Everything comes from R&#8217;s own result. Nothing is guessed, and nothing leaves R.</p>
      </>
    ),
  },
  {
    id: "teaching",
    group: "Making things",
    label: "Teaching with exercises",
    summary: "Turn a script into exercises that check themselves.",
    words: "teach class student exercise homework assignment blank check hint answer course",
    body: () => (
      <>
        <p>
          Write the script as you would anyway. On each line students should write themselves, choose Make this line an exercise, in the Edit menu, and say what to do, with a hint if you like.
        </p>
        <p>
          Save as exercises for students, in the File menu, makes a copy where each of those lines is a blank, such as <code>heavy &lt;- ___</code>. Share that file. Students open it in this app.
        </p>
        <p>
          When a student runs an exercise&#8217;s line, R compares what it makes with what your line makes, so any correct way of writing it counts. If it is not right yet, they are told how it differs, such
          as how many rows it has against how many it should. The hint comes after a first try, and the answer after two. A bar above the script counts the exercises done.
        </p>
      </>
    ),
  },
  {
    id: "shiny",
    group: "Making things",
    label: "Shiny apps",
    summary: "Running a Shiny app beside its code, and checking it for mistakes.",
    words: "shiny app reactive input output server ui share error trace map connects",
    body: () => (
      <>
        <p>
          Open a Shiny app and Run app appears above the script. The app runs in its own R beside your code, so the prompt stays free, and saving a file reloads it. Share makes a web page that runs the app right
          in the browser, so anyone can open it without installing R.
        </p>
        <p>
          As you type, the app is checked for the mistakes Shiny never tells you about: an id spelled differently in the UI and the server, a reactive written as <code>data</code> instead of{" "}
          <code>data()</code>, an input read outside a render function, a render function that does not match its output, and an id used twice. Each one is underlined and listed above the script, with Go to line,
          and a one click fix when the fix is clear.
        </p>
        <p>
          When something breaks while the app is running, Shiny&#8217;s message often points at the wrong place. The App sheet reads Shiny&#8217;s trace for you and tells you where it really went wrong: the line,
          the function, and which output it was making, with a button to jump straight there.
        </p>
        <p>
          The App sheet also shows how the app connects: inputs on the left, reactives in the middle, and outputs on the right, joined by lines. Choose any part to see what it uses and what uses it. An
          output that uses nothing is easy to spot, and is often a mistake.
        </p>
        <p>
          The examples include a simple app, a night sky explorer with sliders and tabs, and one with a few mistakes on purpose so you can see the checks at work.
        </p>
        <ExamplesButton />
      </>
    ),
  },
  {
    id: "wrong",
    group: "When things go wrong",
    show: ["stage"],
    label: "Errors and fixes",
    summary: "Understanding errors and warnings, and fixing them.",
    words: "error warning fail problem fix crash restart forum stack overflow posit community question reprex deprecated retired outdated old",
    body: () => (
      <>
        <p>
          When a line fails, you get a short explanation of what went wrong, and the exact spot is underlined in your script. If the fix is clear, like a misspelled name or a missing package, there is a button that
          makes it for you. R&#8217;s original message is always one click away.
        </p>
        <p>
          A warning means the line ran, but R noticed something worth a look, such as values that could not become numbers. Warnings are explained the same way, marked with a round sign rather than the
          triangle of an error.
        </p>
        <p>If R itself stops, your files stay open and safe. Restart and run brings R back and runs your script again up to where you were, so your objects return.</p>
        <p>If you have the assistant set up, Ask the assistant on a failed result explains the error and suggests a fix.</p>
        <p>
          Fix problems in this script, in the Edit menu, looks through the whole script at once. It finds code that packages have retired, such as <code>size</code> for lines in ggplot2, now{" "}
          <code>linewidth</code>, and anything R warned was deprecated when the script last ran. It also finds the habits the editor underlines, and lines that failed with a clear fix. Each shows the
          line as it is and as it will be. Untick any you want to leave, then fix the rest in one step, which one Undo takes back. Changes that need a person, such as moving from <code>gather()</code>{" "}
          to <code>pivot_longer()</code>, are listed with what to use instead. A deprecation warning on a result has the same button.
        </p>
        <p>
          Still stuck? Ask for help online, on a failed result, writes the question the way forums such as Posit Community and Stack Overflow ask for it: only the lines that led to the error, worked out
          the same way as Where did this come from, the error itself, and your R and package versions. Data read from a file on your computer is replaced by a small sample, the first few rows, so
          anyone can run the code. Read it, untick the sample if the data is private, add what you expected, then copy it. Nothing is sent until you paste it yourself.
        </p>
      </>
    ),
  },
  {
    id: "undo",
    group: "When things go wrong",
    show: ["run"],
    label: "Undo and unsaved work",
    summary: "Undoing a run, earlier versions of a file, and getting back unsaved work.",
    words: "undo revert back restore recover crash autosave save lost history version earlier compare",
    body: () => (
      <>
        <p>
          Undo the last run, with <kbd>{keyLabel("⌥⌘Z")}</kbd> or the button above its result, puts your objects back as they were before you pressed Run. One press of Run is one run, so it takes back a
          whole Run file at once. It tells you what it put back. Files the run saved, and packages it loaded, stay as they are.
        </p>
        <p><kbd>{keyLabel("⌘Z")}</kbd> on its own undoes typing in the script, as anywhere else.</p>
        <p>
          Each save keeps a version of the script, at most one every five minutes, and the last hundred are kept. The clock button beside the file&#8217;s folder, or Earlier versions of this file in the
          File menu, lists them by when they were saved, with what has changed since each in a few words. Choose one to see each change: the old lines in red with a minus, the lines now in green with a
          plus. Copy the old lines, put one part back, or use the whole version. Nothing is saved until you save, and Undo takes it back.
        </p>
        <p>
          Whatever you type is kept safe as you go, even before you save. If the app closes unexpectedly, your changes come back the next time it opens, with a note saying so. To save files by themselves
          as well, turn on Save files automatically in Settings, under Editor.
        </p>
      </>
    ),
  },
  {
    id: "packages",
    group: "When things go wrong",
    show: ["sheets"],
    label: "Packages",
    summary: "Install, check, and update the packages you use.",
    words: "install update library cran package",
    body: () => (
      <>
        <p>
          If a script uses a package you do not have, you will hear about it before you run it, with a button to install it.
        </p>
        <p>
          If a package will not install because it needs other software on your computer, the message says which, and gives the command that installs it, ready to copy.
        </p>
        <p>
          While packages install or update, the result shows each one by name, with a bar for how far along it is, and says which ones did not install. Show what R printed, on the same result, gives R&#8217;s own
          messages instead, and Settings, under R and packages, can show those every time.
        </p>
        <p>
          Packages, on the canvas or in the Packages menu, lists what is installed. Check for updates opens the Updates page in Settings, which lists the packages with newer versions, and Update all
          brings them up to date, with the progress on the stage. Restart R afterward so the new versions are the ones in use.
        </p>
      </>
    ),
  },
  {
    id: "assistant",
    group: "When things go wrong",
    show: ["sheets"],
    label: "The assistant",
    summary: "An optional AI helper that runs on your own computer.",
    words: "ai ollama model chat explain suggest write generate comment draft code",
    body: () => (
      <>
        <p>
          The assistant answers questions about R and your code, explains errors, and suggests code. It is off until you turn it on. It runs on your own computer through Ollama, so nothing you write leaves it.
        </p>
        <p>
          To have it write code, type a comment that says what the code should do, such as <code># mean magnitude for each kind of star</code>, and press <kbd>{keyLabel("⌥⌘G")}</kbd>. The draft
          appears under the comment as it is written, using the objects and columns you have. Insert puts it in, Try again asks for another, and Discard leaves your script as it was. On a line that is
          not a comment, the same keys ask what the code should do.
        </p>
        <p>
          Setup lists only models trained on code, since those write R that runs, and marks the one that suits your computer best.
        </p>
        <p>
          Treat its answers as suggestions. Its code never runs on its own. It only goes into your script when you press Insert or Replace, and R checks first that the code makes sense, so a broken suggestion is
          flagged before you rely on it.
        </p>
      </>
    ),
  },
  {
    id: "keys",
    group: "Reference",
    show: ["search"],
    label: "Keyboard shortcuts",
    summary: "All the keyboard shortcuts.",
    words: "keys keyboard shortcut hotkey palette",
    body: () => (
      <>
        <p>
          <kbd>{keyLabel("⌘K")}</kbd> opens the search at the right of the title bar. With nothing typed, it lists commands under their menu&#8217;s name. It finds any command by name and looks up any function in R help. These commands have shortcuts of their own:
        </p>
        <Shortcuts />
      </>
    ),
  },
  {
    id: "settings",
    group: "Reference",
    label: "Settings and accessibility",
    summary: "Changing how the app looks and works.",
    words: "theme dark light paper font size color blind contrast motion menus preferences autosave focus reset defaults typeface ligatures italic script comments essentials everything layout panes hide show update upgrade version",
    body: () => (
      <>
        <p>
          Settings, from the app menu or <kbd>{keyLabel("⌘,")}</kbd>, changes the look, the size of the text, the font and size of your code, how the editor behaves, and how results show.
        </p>
        <p>Appearance offers Light, Dark, and Paper, a warm, softer page for long reading, or matches your computer.</p>
        <p>
          Code text has more than a dozen typefaces, all free to use, among them Fira Code, JetBrains Mono, Cascadia Code, Atkinson Hyperlegible Mono, and Iosevka. Script italics writes comments in
          Victor Mono&#8217;s flowing italic beside any of them, the look Fira Code iScript is known for.
        </p>
        <p>
          Accessibility has color palettes for each kind of color vision, and one in grays. A palette changes the colors of the whole window: buttons, links, and the
          selection, along with ran, warning, and did not run, the colors of code, and the colors of plots. The preview under the choices shows them. All of them are easy to read, and nothing relies on color alone. Reduce motion turns off animation.
        </p>
        <p>
          Compact, under Appearance, tightens the space around panes for a small screen, and keeps every button just as easy to hit. Documents wrap at a comfortable line length unless you turn that off
          there too.
        </p>
        <p>
          Menus can show the essentials, or everything. Everything adds a few commands for people who know what they want, such as Run to here, Restart R and run the file, and rendering straight to
          HTML, Word, or PDF. It changes nothing else, and the Menus pane lists exactly what it adds.
        </p>
        <p>
          Layout shows the window as a small picture. Press a part, the project sidebar, the R prompt, the canvas, or the earlier results, to hide it, and again to bring it back. The same switches are in
          the View menu. Go back to the standard layout, on the same page or in the View menu, shows every part again at the size it started at, in one press.
        </p>
        <p>
          Updates lists everything that can be updated in one place: this app, R, your packages, Ollama, and the assistant&#8217;s models, each with its version, the newest one, and a button to update it.
          It looks once a day by itself and says when there is something new, or only when you ask. This app updates itself and restarts into the new version when you are ready. R and Ollama open their
          download pages, since they install with their own installers.
        </p>
        <p>
          Each pane has a button to put just that pane back to how it started. Reset the app, at the foot of Settings or in the app menu, puts every setting and the layout back as they were
          when the app was new, and can also clear the recent lists, earlier versions of files, results kept from last time, and the R in use. Your files, packages, and models are never touched.
        </p>
      </>
    ),
  },
  {
    id: "about",
    group: "Reference",
    label: "About",
    summary: "Version, license, and how to tell us about a problem.",
    words: "license version credits bug report privacy",
    body: () => <AboutTopic />,
  },
];

const GROUPS = [...new Set(TOPICS.map((topic) => topic.group))];

function AboutTopic() {
  const version = useStore((state) => state.info?.version);
  return (
    <>
      <p>This is version {version}.</p>
      <p>R runs through ark, the R kernel from Posit.</p>
      <p>You are free to use it for anything noncommercial, such as study, research, teaching, or work at a charity or public body. It is published under the PolyForm Noncommercial License 1.0.0.</p>
      <div className="help-actions">
        <button type="button" className="button" onClick={() => openUrl("issues")}>
          Report a problem on GitHub
        </button>
      </div>
    </>
  );
}

/** Whether a topic matches every word typed in the search box. */
function matches(topic: Topic, query: string) {
  const text = `${topic.label} ${topic.summary} ${topic.words ?? ""} ${topic.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export function HelpScreen() {
  const platform = useStore((state) => state.info?.platform);
  const [topic, setTopic] = useState("start");
  const [query, setQuery] = useState("");
  const current = TOPICS.find((item) => item.id === topic) ?? TOPICS[0];
  const shown = useMemo(() => TOPICS.filter((item) => matches(item, query)), [query]);
  const next = TOPICS[TOPICS.indexOf(current) + 1];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape in the search clears it first, and leaves Help only when the
      // search is already empty.
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && field.value) {
        setQuery("");
        return;
      }
      hideHelpScreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Opening a topic scrolls its page back to the top.
  const go = (id: string, moveFocus = false) => {
    setTopic(id);
    document.querySelector(".help-article")?.scrollTo({ top: 0 });
    // From Next at the foot of a topic, reading goes on at the new heading.
    if (moveFocus) setTimeout(() => document.getElementById("help-topic-title")?.focus(), 0);
  };

  return (
    <div className="help-screen">
      <header className={`opening-bar ${platform === "macos" ? "has-traffic-lights" : ""}`} data-tauri-drag-region>
        <div className="opening-bar-start">
          <button type="button" className="button quiet" onClick={hideHelpScreen}>
            <ArrowIcon direction="left" size={13} />
            Back
          </button>
        </div>
      </header>
      <div className="help-layout">
        <nav className="help-nav" aria-label="Help topics">
          <h1>Help</h1>
          <input
            type="search"
            className="help-search"
            placeholder="Search help"
            aria-label="Search help"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Return opens the first match, so search and go is one step.
              if (event.key === "Enter" && shown[0]) go(shown[0].id);
            }}
          />
          {GROUPS.map((group) => {
            const items = shown.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <section key={group} className="help-nav-group">
                <h2>{group}</h2>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="help-nav-item" aria-current={item.id === current.id ? "page" : undefined} onClick={() => go(item.id)}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {!shown.length && <p className="help-nav-empty">Nothing matches that. Try another word, or press {keyLabel("⌘K")} to search R&#8217;s own help.</p>}
        </nav>
        <article className="help-article" aria-labelledby="help-topic-title">
          <div className="help-article-inner">
            <p className="eyebrow">{current.group}</p>
            <h2 id="help-topic-title" tabIndex={-1}>{current.label}</h2>
            <p className="help-summary">{current.summary}</p>
            {current.show && <ShowMe targets={current.show} />}
            {current.id === "start" ? <StartHere go={go} /> : current.body()}
            {next && (
              <button type="button" className="help-next" onClick={() => go(next.id, true)}>
                Next: {next.label}
                <ArrowIcon direction="right" size={13} />
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
