# Contributing to R: What Is It Good For?

## Before you start

You need Node.js 22, Rust 1.90 or later, and R 4.2 or later. Install
the dependencies and the pinned R kernel with:

```bash
npm install
node scripts/fetch-ark.mjs
```

## Running the app

`npm start` builds the Rust core once and opens the app with the interface
served live, so interface changes appear as you save. Restart it after
changing Rust code, or use `npm run tauri dev`, which rebuilds the Rust
code on every change it sees. In a folder synced by iCloud Drive or a
similar service, prefer `npm start`, since the sync service touches files
and `npm run tauri dev` treats each touch as a change. `npm run
dev` serves the interface alone in a browser, backed by the stand-in for R
in `src/lib/mockBackend.ts`, which is the quickest way to work on layout.

## Running the tests

`npm run verify` runs the writing standards gate, the color contrast
audit, a type checked build, the unit tests, and the Rust tests, in that
order. `npm run test:ui` runs the interface and accessibility tests in
Chromium. Both run in CI on every push, and a change is ready when both
pass locally.

The Rust integration tests in `crates/rsession/tests/integration/` start a
real R. They fail rather than skip when R or ark is missing, because a
skipped test would report a passing build that was never checked.

## Where things live

Talking to R belongs in `crates/rsession`, which has no interface code.
The optional assistant's logic belongs in `crates/assistant`, which also
has no interface code, and its commands in `src-tauri/src/assistant.rs`.
Anything the window asks of the system, files, menus, settings, goes
through a command in `src-tauri/src/lib.rs`. Every read or write must pass
`Allowed::check` in `src-tauri/src/files.rs`, and only the Rust side may
grant a path, from a dialog, a drop, Finder, or its own recent list. Never
add a command that takes a path from the interface and grants it.

Every action the interface can take lives in `src/lib/app.ts`, so menus,
shortcuts, the command palette, and buttons all run the same code. A new
command needs an entry in `src/lib/commands.ts`, a case in `runCommand`,
and, if it belongs in the menu bar, an item with the same id in
`src-tauri/src/menu.rs`. Mark it `advanced` if a new R user does not need
it, and it will appear only in the Everything layer.

## Changing the interface

Read [docs/DESIGN.md](docs/DESIGN.md) first. It explains why the workspace
shows so few controls and where each one went. A new control that is
always on screen needs a reason as strong as the ones there. Most new
commands belong in the menu bar and the command palette instead.

## Adding an error explanation

`src/lib/errors.ts` turns R's error messages into a headline, a plain
explanation, one thing to try, and, where it can be found, the part of the
code that failed. A new explanation is a rule in `RULES`. It needs:

- the R message it matches, as ark sends it. ark puts `Error:` and a line
  break before the message and lists calls in a separate traceback, so
  copy the message from a real session, not from R's own console
- a headline and explanation a new R user would understand, without words
  such as closure, atomic, or vector unless they are explained
- a `where` when the failing part can be found honestly. Mark nothing
  rather than guess between several candidates
- a unit test in `tests/unit/packages_errors.test.ts` with the real
  message

## Adding or changing a color

Colors live only in `src/theme/tokens.json`, once per palette and
appearance. Run `npm run audit:contrast` after any change. It checks every
text and control pair against WCAG 2.2 AA in all five palettes and both
appearances, and checks that warning and error stay apart under simulated
color vision deficiency.

## Style

`scripts/standards/check.mjs` rejects em and en dashes, contractions,
British spellings, and a short list of banned words, and requires about 15
percent of the lines in a logic file to be comments that explain why the
code is as it is. When a line must break a rule, for example because an
R option is spelled the British way, end it with a comment that starts
`standards:` and gives the reason.
