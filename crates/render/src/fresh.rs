//! Checking that a script runs from a clean start.
//!
//! A script often works only because of something done earlier by hand: an
//! object made at the console, a package loaded and never written into the
//! script, a line run and then deleted. Then it fails on a colleague's
//! computer, or on the same one next month. The check runs the script in a
//! new R, with no saved workspace and no startup files, one statement at a
//! time, and stops at the first error with its line. Plots go nowhere, so
//! the check leaves no Rplots.pdf behind.
//!
//! The code arrives in a file of its own, named as an argument, never
//! pasted into the R that runs it.

use crate::plan::Plan;
use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;

/// What the check found: it ran to the end, or the first statement that
/// failed, with its line counted from zero and R's message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    pub ok: bool,
    pub line: Option<usize>,
    pub message: String,
    /// How many statements ran before the end or the failure.
    pub ran: usize,
}

/// The line the result is printed on.
pub const MARKER: &str = "@@goodr-fresh@@";

/// The R that runs the code. Each statement is evaluated in the global
/// environment, as Run file does, and the first error ends the check. The
/// check's own names live in a local environment, so a script that clears
/// the workspace, as many begin by doing, cannot remove them.
const CHECK_CALL: &str = r#"local({
  args <- commandArgs(TRUE)
  options(device = function(...) grDevices::pdf(NULL), warn = 1)
  esc <- function(x) gsub("[\r\n\t]", " ", gsub("\"", "\\\"", gsub("\\", "\\\\", x, fixed = TRUE), fixed = TRUE))
  done <- function(ok, line, message, ran) {
    cat("\n", "@@goodr-fresh@@", "{\"ok\":", tolower(ok), ",\"line\":", if (is.na(line)) "null" else line, ",\"ran\":", ran, ",\"message\":\"", esc(message), "\"}\n", sep = "")
    quit(save = "no", status = 0)
  }
  exprs <- tryCatch(parse(args[1], keep.source = TRUE), error = function(e) e)
  if (inherits(exprs, "error")) {
    line <- suppressWarnings(as.integer(sub("^[^:]*:([0-9]+):.*$", "\\1", conditionMessage(exprs)[1])))
    done(FALSE, if (is.na(line)) NA else line - 1L, paste("R could not read the script:", sub("^[^:]*:[0-9]+:[0-9]+: ", "", conditionMessage(exprs)[1])), 0L)
  }
  refs <- attr(exprs, "srcref")
  for (i in seq_along(exprs)) {
    failed <- tryCatch({ eval(exprs[[i]], globalenv()); NULL }, error = function(e) conditionMessage(e))
    if (!is.null(failed)) done(FALSE, refs[[i]][1] - 1L, failed, i - 1L)
  }
  done(TRUE, NA, "", length(exprs))
})"#;

/// How to run the check of the code in `code_file` with the R at
/// `rscript`, in `dir`, the folder the script's paths are relative to.
pub fn check_plan(rscript: &Path, code_file: &Path, dir: &Path) -> Plan {
    Plan {
        program: rscript.to_path_buf(),
        args: vec![OsString::from("--vanilla"), OsString::from("-e"), OsString::from(CHECK_CALL), code_file.as_os_str().to_os_string()],
        env: vec![("NO_COLOR".to_string(), OsString::from("1"))],
        dir: dir.to_path_buf(),
    }
}

/// Reads the result from the lines the check printed. With no result
/// line, R itself stopped, and the last lines it printed say why.
pub fn read_result(lines: &[String]) -> Checked {
    for line in lines.iter().rev() {
        if let Some(json) = line.split(MARKER).nth(1) {
            if let Some(found) = parse_json(json.trim()) {
                return found;
            }
        }
    }
    let tail: Vec<&str> = lines.iter().rev().filter(|line| !line.trim().is_empty()).take(3).map(String::as_str).collect();
    Checked { ok: false, line: None, message: format!("R stopped before the check finished. {}", tail.into_iter().rev().collect::<Vec<_>>().join(" ")).trim().to_string(), ran: 0 }
}

/// A small reader for the one object the check prints, so the crate needs
/// no JSON library: ok, line, ran, and message, in that order.
fn parse_json(json: &str) -> Option<Checked> {
    let ok = json.contains("\"ok\":true");
    let number = |key: &str| -> Option<usize> {
        let rest = json.split(&format!("\"{key}\":")).nth(1)?;
        rest.split([',', '}']).next()?.trim().parse().ok()
    };
    let message = json.split("\"message\":\"").nth(1)?;
    let message = message.strip_suffix("\"}").unwrap_or(message);
    let message = message.replace("\\\"", "\"").replace("\\\\", "\\");
    Some(Checked { ok, line: number("line"), message, ran: number("ran").unwrap_or(0) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_result_line_is_read() {
        let lines = vec!["loading".to_string(), "@@goodr-fresh@@{\"ok\":false,\"line\":3,\"ran\":2,\"message\":\"object \\\"x\\\" not found\"}".to_string()];
        assert_eq!(read_result(&lines), Checked { ok: false, line: Some(3), message: "object \"x\" not found".into(), ran: 2 });
        let ok = vec!["@@goodr-fresh@@{\"ok\":true,\"line\":null,\"ran\":5,\"message\":\"\"}".to_string()];
        assert_eq!(read_result(&ok), Checked { ok: true, line: None, message: String::new(), ran: 5 });
    }

    #[test]
    fn r_stopping_early_says_why() {
        let lines = vec!["Fatal error: cannot open file".to_string()];
        let found = read_result(&lines);
        assert!(!found.ok);
        assert!(found.message.contains("cannot open file"));
    }

    #[test]
    fn the_code_is_an_argument_and_startup_files_are_skipped() {
        let plan = check_plan(Path::new("/opt/R/bin/Rscript"), Path::new("/tmp/code.R"), Path::new("/work"));
        assert_eq!(plan.args[0], "--vanilla");
        assert_eq!(plan.args.last().unwrap(), "/tmp/code.R");
        assert_eq!(plan.dir, Path::new("/work"));
    }
}
