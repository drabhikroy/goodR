//! Rendering reports: Quarto documents (.qmd) and R Markdown documents
//! (.Rmd) turned into HTML, Word, or PDF with the person's own R.
//!
//! The pieces follow one render from start to finish:
//!
//! - `find` locates Quarto and the R chosen in the app, without asking the
//!   person to set any paths.
//! - `plan` decides which program runs, with which arguments, in which
//!   folder, for the format the person asked for.
//! - `run` starts that program in a process group of its own, streams its
//!   lines as they arrive, and can stop it along with every R process it
//!   started.
//! - `parse` reads those lines: progress through the chunks, the files
//!   that were made, and, when a render fails, what went wrong and where.
//!
//! Rendering runs in a separate R from the console's, as RStudio does when
//! it knits. A report then shows exactly what its own code makes from a
//! clean start, and nothing in the person's workspace is changed by it.

pub mod find;
pub mod parse;
pub mod plan;
pub mod run;

pub use find::Tools;
pub use parse::{Failure, Line};
pub use plan::{Kind, Plan, Target};
pub use run::{Finished, Outcome};
