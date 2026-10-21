//! What runs for a render: which program, with which arguments, where.
//!
//! Quarto documents render with Quarto. R Markdown documents render with
//! rmarkdown in a fresh Rscript, so their `output:` settings apply exactly
//! as the author wrote them. Both use the R chosen in the app.
//!
//! PDF is the one format handled differently. Quarto can make a PDF with
//! Typst, a typesetting program it carries inside itself, so no LaTeX
//! installation is needed, and a LaTeX install is a large, slow first step
//! that stops many newcomers. When the user has chosen LaTeX for PDFs,
//! or has a LaTeX and left the choice to the app, Render as PDF uses
//! LaTeX: Quarto's own PDF for a Quarto document, and rmarkdown's
//! pdf_document for R Markdown, which then needs no Quarto. Otherwise it
//! uses Typst through Quarto, for R Markdown too. Whichever LaTeX is in
//! use goes first on the PATH of every render, so a document whose header
//! asks for LaTeX finds it when rendered as written.

use crate::find::Tools;
use crate::parse::Failure;
use serde::Deserialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The two kinds of report the editor renders.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Quarto,
    RMarkdown,
}

impl Kind {
    /// The kind of report a file is, from its extension, or None when it is
    /// not a report at all.
    pub fn of(path: &Path) -> Option<Kind> {
        match path.extension()?.to_str()? {
            "qmd" => Some(Kind::Quarto),
            "Rmd" | "rmd" => Some(Kind::RMarkdown),
            _ => None,
        }
    }
}

/// The format the user asked for. `AsWritten` follows the document's own
/// header, which is what the Render button does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    AsWritten,
    Html,
    Word,
    Pdf,
}

/// One program to start, ready for `run`.
#[derive(Clone, Debug)]
pub struct Plan {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
    /// The report's own folder, so paths inside it mean what they say.
    pub dir: PathBuf,
}

/// The R that renders an R Markdown document. The file and format arrive
/// as command line arguments rather than inside the code, so no path or
/// name can change what the code does. Each file made is printed after a
/// marker, so the app learns its full path without guessing.
const RMARKDOWN_CALL: &str = r#"args <- commandArgs(TRUE)
format <- if (nzchar(args[2])) args[2] else NULL
made <- rmarkdown::render(args[1], output_format = format, encoding = "UTF-8", envir = new.env())
for (file in made) cat("\n@@goodr-output@@", normalizePath(file), "\n", sep = "")"#;

/// Decides how to render `source` as `target`, or says why it cannot be
/// rendered on this computer yet.
pub fn plan(source: &Path, target: Target, tools: &Tools) -> Result<Plan, Failure> {
    let kind = Kind::of(source).ok_or(Failure::NotReport)?;
    let dir = source.parent().map(Path::to_path_buf).unwrap_or_default();
    let file: OsString = source.file_name().unwrap_or_default().to_os_string();
    if !tools.rscript.is_file() {
        return Err(Failure::NoR);
    }
    // Every render points at the chosen R and its Pandoc, and turns off the
    // terminal colors that would otherwise arrive as stray codes.
    let mut env = vec![("NO_COLOR".to_string(), OsString::from("1")), ("QUARTO_R".to_string(), tools.rscript.clone().into_os_string())];
    if let Some(pandoc) = &tools.pandoc_dir {
        if std::env::var_os("RSTUDIO_PANDOC").is_none() {
            env.push(("RSTUDIO_PANDOC".to_string(), pandoc.clone().into_os_string()));
        }
    }
    if let Some(latex) = &tools.latex {
        env.push(("PATH".to_string(), crate::latex::path_with(latex)));
    }
    let pdf_latex = target == Target::Pdf && tools.pdf_with_latex;
    if pdf_latex && tools.latex.is_none() {
        return Err(Failure::Latex);
    }
    let with_quarto = kind == Kind::Quarto || (target == Target::Pdf && !pdf_latex);
    if with_quarto {
        let quarto = tools.quarto.clone().ok_or(Failure::NoQuarto)?;
        let mut args = vec![OsString::from("render"), file];
        let to = match target {
            Target::AsWritten => None,
            Target::Html => Some("html"),
            Target::Word => Some("docx"),
            Target::Pdf if pdf_latex => Some("pdf"),
            Target::Pdf => Some("typst"),
        };
        if let Some(to) = to {
            args.push("--to".into());
            args.push(to.into());
        }
        return Ok(Plan { program: quarto, args, env, dir });
    }
    let format = match target {
        Target::AsWritten => "",
        Target::Html => "html_document",
        Target::Word => "word_document",
        Target::Pdf => "pdf_document",
    };
    let args = vec![OsString::from("-e"), OsString::from(RMARKDOWN_CALL), file, OsString::from(format)];
    Ok(Plan { program: tools.rscript.clone(), args, env, dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools(dir: &Path, quarto: bool) -> Tools {
        let rscript = dir.join("Rscript");
        std::fs::write(&rscript, "").unwrap();
        let quarto = quarto.then(|| {
            let path = dir.join("quarto");
            std::fs::write(&path, "").unwrap();
            path
        });
        Tools { quarto, rscript, pandoc_dir: None, latex: None, pdf_with_latex: false }
    }

    #[test]
    fn a_quarto_document_renders_with_quarto_in_its_own_folder() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan(&dir.path().join("report.qmd"), Target::AsWritten, &tools(dir.path(), true)).unwrap();
        assert!(plan.program.ends_with("quarto"));
        assert_eq!(plan.args, vec![OsString::from("render"), OsString::from("report.qmd")]);
        assert_eq!(plan.dir, dir.path());
        assert!(plan.env.iter().any(|(name, value)| name == "QUARTO_R" && value == &dir.path().join("Rscript").into_os_string()));
    }

    #[test]
    fn pdf_uses_typst_so_no_latex_is_needed() {
        let dir = tempfile::tempdir().unwrap();
        let tools = tools(dir.path(), true);
        let quarto = plan(&dir.path().join("report.qmd"), Target::Pdf, &tools).unwrap();
        assert_eq!(quarto.args[2..], [OsString::from("--to"), OsString::from("typst")]);
        // R Markdown goes through Quarto for PDF too, when Quarto is here.
        let rmd = plan(&dir.path().join("notes.Rmd"), Target::Pdf, &tools).unwrap();
        assert!(rmd.program.ends_with("quarto"));
    }

    #[test]
    fn r_markdown_renders_with_rmarkdown_and_passes_the_file_as_an_argument() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan(&dir.path().join("notes.Rmd"), Target::Word, &tools(dir.path(), false)).unwrap();
        assert!(plan.program.ends_with("Rscript"));
        assert_eq!(plan.args[2..], [OsString::from("notes.Rmd"), OsString::from("word_document")]);
    }

    #[test]
    fn missing_programs_and_other_files_are_named() {
        let dir = tempfile::tempdir().unwrap();
        let without = tools(dir.path(), false);
        assert_eq!(plan(&dir.path().join("report.qmd"), Target::Html, &without).unwrap_err(), Failure::NoQuarto);
        assert_eq!(plan(&dir.path().join("analysis.R"), Target::Html, &without).unwrap_err(), Failure::NotReport);
        // Unless LaTeX was chosen, a PDF is made with Typst, so it asks for
        // Quarto rather than falling back to LaTeX.
        assert_eq!(plan(&dir.path().join("notes.Rmd"), Target::Pdf, &without).unwrap_err(), Failure::NoQuarto);
        let no_r = Tools { quarto: None, rscript: dir.path().join("missing"), pandoc_dir: None, latex: None, pdf_with_latex: false };
        assert_eq!(plan(&dir.path().join("notes.Rmd"), Target::Html, &no_r).unwrap_err(), Failure::NoR);
    }

    #[test]
    fn pdf_uses_latex_when_chosen_and_says_so_when_there_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let mut with_latex = tools(dir.path(), false);
        with_latex.pdf_with_latex = true;
        // No LaTeX yet: the failure that offers to install one.
        assert_eq!(plan(&dir.path().join("notes.Rmd"), Target::Pdf, &with_latex).unwrap_err(), Failure::Latex);
        with_latex.latex = Some(dir.path().join("texbin"));
        // R Markdown makes its own PDF with LaTeX, so Quarto is not needed.
        let rmd = plan(&dir.path().join("notes.Rmd"), Target::Pdf, &with_latex).unwrap();
        assert!(rmd.program.ends_with("Rscript"));
        assert_eq!(rmd.args.last().unwrap(), "pdf_document");
        let path = rmd.env.iter().find(|(name, _)| name == "PATH").unwrap();
        assert_eq!(std::env::split_paths(&path.1).next().unwrap(), dir.path().join("texbin"));
        // Quarto asks for its LaTeX PDF rather than Typst.
        let mut quarto = tools(dir.path(), true);
        quarto.pdf_with_latex = true;
        quarto.latex = Some(dir.path().join("texbin"));
        let qmd = plan(&dir.path().join("report.qmd"), Target::Pdf, &quarto).unwrap();
        assert_eq!(qmd.args[2..], [OsString::from("--to"), OsString::from("pdf")]);
    }
}
