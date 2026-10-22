# Contributing to R: What Is It Good For?

## Before you start

You need Node.js 22, Rust 1.90 or later, and R 4.2 or later. Then install
the dependencies and the pinned R kernel (ark, the program that runs your
R code for the app):

```bash
npm install
node scripts/fetch-ark.mjs
```

## Running the app

`npm start` builds the Rust core once and opens the app. The interface is
served live, so interface changes show up as you save. Rust changes do
not, so restart it after changing Rust code.

`npm run tauri dev` is the other option. It rebuilds the Rust code on every
change it sees. That causes trouble in a folder synced by iCloud Drive or
a similar service, because the sync service touches files and each touch
counts as a change. Use `npm start` there.

To work on layout, `npm run dev` is the quickest route. It serves the
interface alone in a browser, with a stand-in for R in
`src/lib/mockBackend.ts`.

## Running the tests

`npm run verify` runs, in this order, the writing standards gate, the color
contrast audit, a type checked build, the unit tests, and the Rust tests.
`npm run test:ui` runs the interface and accessibility tests in Chromium.
CI runs both on every push. A change is ready when both pass on your
machine.

The Rust integration tests in `crates/rsession/tests/integration/` start a
real R. If R or ark is missing they fail instead of skipping. A skipped
test would let the build report a pass for something nobody checked.

## Where things live

Code that talks to R goes in `crates/rsession`, which has no interface
code. The optional assistant's logic goes in `crates/assistant`, which
also has no interface code. Its commands are in
`src-tauri/src/assistant.rs`.

Anything the window asks of the system (files, menus, settings) goes
through a command in `src-tauri/src/lib.rs`. Every read or write must pass
`Allowed::check` in `src-tauri/src/files.rs`. Only the Rust side may grant
access to a path, and only from a dialog, a drop, Finder, or its own recent
list. Never add a command that takes a path from the interface and grants
it.

Every action the interface can take lives in `src/lib/app.ts`. Menus,
shortcuts, the command palette, and buttons all call that same code. To
add a command:

1. Add an entry in `src/lib/commands.ts`.
2. Add a case in `runCommand`.
3. If it belongs in the menu bar, add an item with the same id in
   `src-tauri/src/menu.rs`.

Mark the command `advanced` if a new R user does not need it. It will then
appear only in the Everything layer.

## Changing the interface

Read [the design notes in docs/DESIGN.md](docs/DESIGN.md) first. They
explain why the workspace shows so few controls and where each one went.
A new control that stays on screen all the time needs a reason as strong
as the ones given there. Most new commands belong in the menu bar and the
command palette instead.

## Adding an error explanation

`src/lib/errors.ts` turns R's error messages into four things: a headline,
a plain explanation, one thing to try, and, when it can be found, the part
of the code that failed. Each explanation is a rule in `RULES`. A new rule
needs:

- The R message it matches, exactly as ark sends it. ark puts `Error:` and
  a line break before the message, and it lists calls in a separate
  traceback. So copy the message from a real session, not from R's own
  console.
- A headline and explanation a new R user would understand. Avoid words
  such as closure, atomic, or vector unless you explain them.
- A `where`, but only when the failing part can be found honestly. If
  there are several candidates, mark nothing rather than guess.
- A unit test in `tests/unit/packages_errors.test.ts` that uses the real
  message.

## Adding or changing a color

Colors live only in `src/theme/tokens.json`, once for each palette and
appearance. Run `npm run audit:contrast` after any change. It checks every
pair of text and control colors against WCAG 2.2 AA (the web accessibility
standard for contrast) in all five palettes and both appearances. It also
checks that warning and error colors stay distinct under simulated color
vision deficiency.

## Style

`scripts/standards/check.mjs` rejects em and en dashes, contractions,
British spellings, and a short list of banned words. It also requires
comments on at least 10 percent of the lines in any logic file of 40 lines
or more.

Sometimes a line has to break a rule, for example because an R option uses
the British spelling. End that line with a comment that starts with
`standards:` and gives the reason.
