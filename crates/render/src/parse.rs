//! Reading what Quarto and rmarkdown print while they work.
//!
//! Three things matter to the person watching: how far the render has got,
//! which files it made, and, when it fails, what went wrong and where. The
//! wording of R's own message is passed on unchanged, because the interface
//! turns it into plain language with the same rules it uses for the
//! console, so an error reads the same wherever it happens.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// The marker the R Markdown call prints before each file it made.
pub const OUTPUT_MARKER: &str = "@@goodr-output@@";

/// Why a render could not finish, in a form the interface can explain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Failure {
    /// The file is not a Quarto or R Markdown document.
    NotReport,
    /// The R chosen in the app is no longer where it was.
    NoR,
    /// A Quarto document, and Quarto is not on this computer.
    NoQuarto,
    /// R Markdown needs Pandoc, and none was found.
    NoPandoc,
    /// The document asks for a LaTeX PDF and LaTeX is missing or failed.
    Latex,
    /// A code chunk stopped with an error. Lines count from one, from the
    /// chunk's first line of code to its closing fence, as knitr reports.
    #[serde(rename_all = "camelCase")]
    Chunk { from: u32, to: u32, label: String, message: String },
    /// Anything else, with the clearest lines of the program's own message.
    Other { message: String },
    /// The person pressed Stop.
    Stopped,
}

/// What one printed line means.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Line {
    /// knitr finished part `done` of `total`, and is starting the chunk
    /// with this label when it has one.
    Progress { done: u32, total: u32, label: Option<String> },
    /// A file the render made.
    Made(PathBuf),
    /// Anything else, kept for the full log.
    Text,
}

/// Removes terminal color codes, which some programs print even when asked
/// not to.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // An escape sequence runs to its first letter.
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Reads one line, already free of color codes. Paths are taken relative
/// to the report's folder, where the render runs.
pub fn classify(line: &str, dir: &Path) -> Line {
    let trimmed = line.trim();
    if let Some(path) = trimmed.strip_prefix(OUTPUT_MARKER) {
        return Line::Made(PathBuf::from(path.trim()));
    }
    if let Some(path) = trimmed.strip_prefix("Output created:") {
        return Line::Made(dir.join(path.trim()));
    }
    progress(trimmed).unwrap_or(Line::Text)
}

/// knitr's progress lines read "3/7" or "4/7 [plot-it]".
fn progress(line: &str) -> Option<Line> {
    let (count, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
    let (done, total) = count.split_once('/')?;
    let done: u32 = done.parse().ok()?;
    let total: u32 = total.parse().ok()?;
    if done == 0 || done > total {
        return None;
    }
    let rest = rest.trim();
    let label = rest.strip_prefix('[').and_then(|inner| inner.strip_suffix(']')).map(str::to_string);
    // Anything other than a label after the count means this is ordinary
    // text that happens to start with a fraction.
    if !rest.is_empty() && label.is_none() {
        return None;
    }
    Some(Line::Progress { done, total, label })
}

/// Works out why a render that exited with an error failed, from every
/// line it printed.
pub fn diagnose(lines: &[String]) -> Failure {
    // knitr names the chunk that failed in one line, then R's message.
    if let Some(index) = lines.iter().rposition(|line| line.trim_start().starts_with("Quitting from lines")) {
        if let Some((from, to, label)) = quitting(lines[index].trim()) {
            let message = error_message(&lines[index + 1..]).unwrap_or_default();
            return Failure::Chunk { from, to, label, message };
        }
    }
    let all = lines.join("\n");
    if all.contains("pandoc version") && all.contains("required") {
        return Failure::NoPandoc;
    }
    let latex = ["No TeX installation", "LaTeX failed to compile", "pdflatex not found", "! LaTeX Error", "No LaTeX installation"];
    if latex.iter().any(|sign| all.contains(sign)) {
        return Failure::Latex;
    }
    Failure::Other { message: error_message(lines).unwrap_or_else(|| last_lines(lines)) }
}

/// Reads "Quitting from lines 19-21 [label] (file.qmd)". Older knitr
/// leaves out the label, and some versions write "lines 19-21 (file)".
fn quitting(line: &str) -> Option<(u32, u32, String)> {
    let rest = line.strip_prefix("Quitting from lines")?.trim_start();
    let (range, rest) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let (from, to) = range.split_once('-').unwrap_or((range, range));
    let from: u32 = from.parse().ok()?;
    let to: u32 = to.parse().ok()?;
    let rest = rest.trim_start();
    let label = rest.strip_prefix('[').and_then(|inner| inner.split_once(']')).map(|(label, _)| label.to_string()).unwrap_or_default();
    Some((from, to, label))
}

/// R's error message, without the "Error in" header, the backtrace, or
/// the "Execution halted" that follows every failed script.
fn error_message(lines: &[String]) -> Option<String> {
    let start = lines.iter().position(|line| {
        let line = line.trim_start();
        line.starts_with("Error") || line.starts_with("ERROR:")
    })?;
    let first = lines[start].trim();
    let mut parts: Vec<String> = Vec::new();
    // Quarto's own errors read "ERROR: what happened".
    if let Some(text) = first.strip_prefix("ERROR:") {
        parts.push(text.trim().to_string());
    } else if let Some((_, text)) = first.split_once(" : ") {
        // Classic R: "Error in f(x) : message".
        parts.push(text.trim().to_string());
    } else if let Some(text) = first.strip_prefix("Error:").filter(|text| !text.trim().is_empty()) {
        parts.push(text.trim().to_string());
    }
    // rlang style puts each part of the message on its own line after a
    // header, starting with "!", and classic messages can run on too.
    for line in &lines[start + 1..] {
        let text = line.trim();
        if text.is_empty() || text.starts_with("Backtrace") || text.starts_with("Execution halted") || text.starts_with("Calls:") || text.starts_with("Quitting from") {
            break;
        }
        parts.push(text.trim_start_matches("! ").to_string());
    }
    let message = parts.join("\n").trim().to_string();
    (!message.is_empty()).then_some(message)
}

/// The last few lines with words in them, for a failure nothing else
/// explains.
fn last_lines(lines: &[String]) -> String {
    let useful: Vec<&str> = lines.iter().map(|line| line.trim()).filter(|line| !line.is_empty()).collect();
    useful[useful.len().saturating_sub(4)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_string).collect()
    }

    #[test]
    fn colors_are_removed() {
        assert_eq!(strip_ansi("\u{1b}[31mError:\u{1b}[39m"), "Error:");
    }

    #[test]
    fn progress_and_outputs_are_read() {
        let dir = Path::new("/work");
        assert_eq!(classify("2/7 [setup]          ", dir), Line::Progress { done: 2, total: 7, label: Some("setup".into()) });
        assert_eq!(classify("3/7", dir), Line::Progress { done: 3, total: 7, label: None });
        assert_eq!(classify("Output created: report.html", dir), Line::Made(PathBuf::from("/work/report.html")));
        assert_eq!(classify("@@goodr-output@@/work/notes.html", dir), Line::Made(PathBuf::from("/work/notes.html")));
        // A sentence that starts with a fraction is not progress.
        assert_eq!(classify("1/2 of the rows are missing", dir), Line::Text);
    }

    #[test]
    fn a_failing_chunk_is_found_with_its_lines_and_message() {
        // As Quarto 1.6 with knitr 1.45 prints it.
        let quarto = lines("processing file: e.qmd\n6/7 [unnamed-chunk-1]\n\n\nQuitting from lines 19-21 [unnamed-chunk-1] (e.qmd)\nError:\n! object 'nosuchthing' not found\nExecution halted");
        assert_eq!(diagnose(&quarto), Failure::Chunk { from: 19, to: 21, label: "unnamed-chunk-1".into(), message: "object 'nosuchthing' not found".into() });
        // As rmarkdown prints it, with a backtrace after the message.
        let rmd = lines("Quitting from lines 11-13 [unnamed-chunk-1] (f.Rmd)\nError in `library()`:\n! there is no package called 'gtx'\nBacktrace:\n 1. base::library(gtx)\nExecution halted");
        assert_eq!(diagnose(&rmd), Failure::Chunk { from: 11, to: 13, label: "unnamed-chunk-1".into(), message: "there is no package called 'gtx'".into() });
        // Older knitr, with the message on the header line.
        let old = lines("Quitting from lines 4-6 (a.Rmd)\nError in mean(x) : object 'x' not found\nCalls: <Anonymous> ...");
        assert_eq!(diagnose(&old), Failure::Chunk { from: 4, to: 6, label: String::new(), message: "object 'x' not found".into() });
    }

    #[test]
    fn missing_tools_and_other_failures_are_named() {
        assert_eq!(diagnose(&lines("Error: pandoc version 1.12.3 or higher is required and was not found (see the help page ?rmarkdown::pandoc_available).")), Failure::NoPandoc);
        assert_eq!(diagnose(&lines("ERROR: \nNo TeX installation was detected.")), Failure::Latex);
        assert_eq!(
            diagnose(&lines("Error in loadNamespace(x) : there is no package called 'rmarkdown'\nCalls: loadNamespace ...\nExecution halted")),
            Failure::Other { message: "there is no package called 'rmarkdown'".into() }
        );
        assert_eq!(diagnose(&lines("ERROR: YAMLError: bad indentation of a mapping entry")), Failure::Other { message: "YAMLError: bad indentation of a mapping entry".into() });
    }
}
