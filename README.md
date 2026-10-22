# R: What Is It Good For?

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgray)](#what-you-need)
![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-arm64-black?logo=apple&logoColor=white)
![Intel](https://img.shields.io/badge/Intel-x86__64-black?logo=apple&logoColor=white)
[![Release](https://img.shields.io/github/v/release/drabhikroy/goodR)](https://github.com/drabhikroy/goodR/releases)

R: What Is It Good For? is a Mac app for writing and running R. It keeps your code and your results side by side, so when you run a line, its chart, table, or printout appears right next to it. When something goes wrong, the app explains the problem in everyday language, points to the line that caused it, and offers a fix when there is a simple one.

It is made for people who are learning R, teaching it, or using it for research, and who would rather spend their time on the analysis than on setting up tools. Everything runs on your own Mac.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/opening-dark.png">
  <img alt="The opening screen. On the left, the app name and buttons to start a new script, report, Shiny app, or project, or open one. On the right, the examples, the tour, a first project, and recent projects and scripts." src="docs/images/opening-light.png">
</picture>

## What using it is like

The opening screen lets you start a new script, report, Shiny app, or project, or pick up something you worked on recently. If you are new, you can also try the examples, take a two minute tour of the window, or follow a guided first project that goes from a data file to a finished report.

Your script sits on the left side of the window. Put the cursor on a line and press Command Return to run it. The result appears on the right, on what the app calls the canvas. Earlier results collect in a strip underneath, and each one stays linked to its line: click a result to jump to the code that made it, or click a line to bring its result back.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workspace-dark.png">
  <img alt="The workspace with the penguins project. The script is on the left. On the right, the canvas shows a bar chart made by lines 15 and 16, with buttons to edit its labels, show it full size, or export it. Earlier results run in a strip underneath. A band above the script offers to install gt, a package that line 19 needs." src="docs/images/workspace-light.png">
</picture>

If a line fails, you do not get R's error message on its own. The app tells you in plain words what went wrong and marks the spot in your script. R's original message is still there if you want it. For common problems, such as a package that is not installed yet, there is a button that fixes it.

The same window handles the rest of the work. You can look through a data table column by column, write a report in R Markdown or Quarto and see it as it will look, or run a Shiny app right beside its code. The [feature guide](docs/FEATURES.md) walks through all of it, with screenshots.

## Getting started

### What you need

You need a Mac running macOS 12 Monterey or later. Macs with Apple silicon (M1 and newer) and older Intel Macs both work.

You also need R, version 4.2 or later. The app uses the R installed on your Mac rather than bringing its own, so if you have not installed R before, do that first:

1. Go to [R for macOS on CRAN](https://cran.r-project.org/bin/macosx/), the official download site.
2. Download the installer that matches your Mac. Choose the one marked arm64 for Apple silicon, or x86_64 for an Intel Mac. To check which Mac you have, open the Apple menu and choose About This Mac. A chip name that starts with "Apple" means Apple silicon.
3. Open the downloaded file and follow the steps.

### Installing the app

1. Download [goodR.dmg](https://github.com/drabhikroy/goodR/releases/latest/download/goodR.dmg). The same file works on every Mac.
2. Open it, and drag goodR into your Applications folder.
3. Open goodR from Applications.

The app is signed and checked by Apple, so it opens without a security warning. When it starts, it finds R on your Mac and starts it for you. If you have more than one version of R, it asks which one to use. You can change that later in Settings.

### Extras for reports and apps

Writing and running R needs nothing more. A few features use extra tools, and the app tells you when one is missing:

- Reports need two R packages, rmarkdown and knitr. The app can install them with one click.
- Quarto documents need [Quarto](https://quarto.org/docs/get-started/), which is a separate download.
- PDFs need either LaTeX or Quarto. If you have neither, the app can install a small version of LaTeX for you.
- Shiny apps need the shiny package, which the app offers to install the first time you run one.

## Your privacy

The app does not collect usage data or send crash reports, and your code and data stay on your Mac. It only goes online to check for updates, and you can set it to check only when you ask. The optional assistant, which can explain errors and suggest code, also runs on your own Mac.

The app opens only the scripts you choose. It never opens your data files itself; R reads them when your code runs. [Your files and your privacy](docs/PRIVACY.md) has the details.

## Accessibility

The app is built to the WCAG 2.2 AA accessibility standard. Everything can be done from the keyboard, and screen readers such as VoiceOver hear results and status changes as they happen. Color is never the only way information is shown, and there are palettes for different kinds of color vision. You can make text larger, turn off animation, and choose a light, dark, or softer paper look.

Automated checks catch a lot, but not everything. If something gets in your way, please [open an issue](https://github.com/drabhikroy/goodR/issues). The full list of what is in place is in [Accessibility](docs/ACCESSIBILITY.md).

## Getting help

Inside the app, open Help from the Help menu or with Shift Command /. It has the tour, the examples, a search box, and answers to common questions, and each topic can point to the part of the window it describes.

To report a problem or suggest an idea, [open an issue on GitHub](https://github.com/drabhikroy/goodR/issues). To report a security problem privately, follow [the security policy](SECURITY.md).

## What is coming

The app runs only on macOS for now. Versions for Windows and Linux are planned, along with a Git panel, background jobs for long scripts, results in a separate window, and publishing a Shiny app's web page in one step.

## For developers

Building from source, running the tests, how the app works inside, and how releases are signed are all covered in [Developing goodR](docs/DEVELOPING.md). [CONTRIBUTING.md](CONTRIBUTING.md) explains how the code is organized and what the checks expect, and [docs/DESIGN.md](docs/DESIGN.md) explains the reasoning behind the design, with the research each decision rests on. Please also read the [code of conduct](CODE_OF_CONDUCT.md).

## Credits

The name comes from the question many people ask when they first meet R, with a nod to the song. The answer, on the opening screen, is "Absolutely everything."

R runs inside the app through [ark](https://github.com/posit-dev/ark), made by Posit Software, PBC, and used under the MIT License. Its license and notice ship with the app. The interface uses the DM Sans and DM Mono typefaces, used under the SIL Open Font License.

## License

The app is free for personal use, study, teaching, academic research, and use by charitable, educational, nonprofit, public research, public health, and government organizations. Commercial use needs a separate license. The terms are the [PolyForm Noncommercial License 1.0.0](LICENSE.md), also published at <https://polyformproject.org/licenses/noncommercial/1.0.0>.

Required notice: © 2026 Abhik Roy.
