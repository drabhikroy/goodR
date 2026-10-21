//! Rendering reports: Quarto documents (.qmd) and R Markdown documents
//! (.Rmd) turned into HTML, Word, or PDF with the user's own R. Shiny
//! apps run here too, since an app is followed and stopped the same way.
//!
//! The pieces follow one render from start to finish:
//!
//! - `find` locates Quarto and the R chosen in the app, without asking the
//!   person to set any paths.
//! - `plan` decides which program runs, with which arguments, in which
//!   folder, for the format the user asked for.
//! - `run` starts that program in a process group of its own, streams its
//!   lines as they arrive, and can stop it along with every R process it
//!   started.
//! - `parse` reads those lines: progress through the chunks, the files
//!   that were made, and, when a render fails, what went wrong and where.
//! - `shiny` plans a Shiny app's R and reads what it prints: when it is
//!   ready, errors inside the running app, and why it ended. It also
//!   plans exporting an app as a web page that runs without R.
//! - `serve` previews an exported web page on a loopback port.
//! - `fresh` runs a script in a new R, one statement at a time, to check
//!   that it works from a clean start.
//! - `latex` finds a LaTeX on the computer for PDFs, or installs TinyTeX
//!   into a folder of the app's own.
//!
//! Rendering runs in a separate R from the console's, as RStudio does when
//! it knits. A report then shows exactly what its own code makes from a
//! clean start, and nothing in the user's workspace is changed by it.

pub mod find;
pub mod fresh;
pub mod latex;
pub mod parse;
pub mod plan;
pub mod run;
pub mod serve;
pub mod shiny;

pub use find::Tools;
pub use parse::{Failure, Line};
pub use plan::{Kind, Plan, Target};
pub use run::{Finished, Outcome};
