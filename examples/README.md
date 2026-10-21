# Examples

A small project to try the app with, built on real data that is not the
usual iris, mtcars, or penguins. Every file runs on a fresh install of R
with no extra packages, except the Shiny apps, which offer to install
shiny the first time.

Open a script from the sidebar and press Command Return (Control Enter on
Windows and Linux) to run a line. Results, plots, and messages appear in
the canvas beside the script. Press Command Shift Return to run the whole
file.

| File | What it shows |
| --- | --- |
| 01-first-steps.R | Running lines, vectors, and a first plot, timing sunlight across the solar system |
| 02-data-frames.R | Reading a file, cleaning real mess, groups, and the data viewer, with 5,000 meteorites |
| 03-plots.R | Several kinds of plot, a map from coordinates, and a chart of the whole night sky |
| 04-a-model.R | A linear model that finds Kepler's third law again in planets around other stars |
| 05-when-things-go-wrong.R | Errors and a warning explained in plain words, with fixes |
| 06-report.qmd | A Quarto field guide to the stars you can see from a town |
| 07-notebook.Rmd | An R Markdown notebook on sixty years of space launches |
| 08-rmarkdown-basics.Rmd | R Markdown from the start: text, numbers in sentences, tables, plots |
| shiny-basic/app.R | The smallest useful Shiny app: pick a constellation and see its stars |
| shiny-night-sky/app.R | A fuller Shiny app that filters the night sky by brightness, distance, and kind of star |
| shiny-launches/app.R | A Shiny app exploring space launches by year and by who launched them |
| shiny-mistakes/app.R | A Shiny app with four mistakes on purpose, to see them found and fixed |

These are copies. Change them as much as you like. To get back a file you
deleted, choose Open Examples in the Help menu again.

## Where the data comes from

- **data/meteorites.csv**: every meteorite seen falling to Earth, and a
  random sample of 4,000 of those found later, from the Meteoritical
  Society's Meteoritical Bulletin, as published by NASA on its open data
  portal (Meteorite Landings). United States government work, in the
  public domain.
- **data/bright_stars.csv**: the 894 stars of magnitude 4.5 or brighter,
  with names, distance in light years, temperature, and true color, from
  the HYG Database 4.1 by David Nash (github.com/astronexus/HYG-Database),
  under the Creative Commons Attribution-ShareAlike 4.0 license. The
  details are in data/bright_stars-license.txt.
- **data/exoplanets.csv**: confirmed planets around other stars, from the
  Open Exoplanet Catalogue by Hanno Rein and contributors <!-- standards: proper name -->
  (github.com/OpenExoplanetCatalogue), under the MIT license. Copyright
  (C) 2020 Hanno Rein.
- **data/launches.csv** and **shiny-launches/launches_by_year.csv**: launch
  attempts toward orbit from 1957 to 2018, from Jonathan McDowell's JSR
  Launch Vehicle Database (planet4589.org), as prepared by *The Economist*
  for its article "The space race is dominated by new contenders" (2018).

The launch and meteorite files were taken from the copies the
TidyTuesday project keeps on GitHub, and trimmed to the columns used here.
