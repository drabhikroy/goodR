//! Small R functions the app calls behind the scenes.
//!
//! They live in an attached environment named "tools:goodfor", the same way
//! RStudio attaches "tools:rstudio", so they never appear among the person's
//! objects and never mask a name they define. They depend only on base R,
//! because the app must work before any package is installed. Each prints a
//! single line of JSON for the Rust side to read.

/// Loaded into every new session right after R starts.
pub const SOURCE: &str = r#"
local({
  if ("tools:goodfor" %in% search()) detach("tools:goodfor")
  gf <- new.env()

  gf$.gf_str <- function(x) {
    x <- enc2utf8(as.character(x))
    x[is.na(x)] <- "NA"
    x <- gsub("\\", "\\\\", x, fixed = TRUE)
    x <- gsub("\"", "\\\"", x, fixed = TRUE)
    x <- gsub("\n", "\\n", x, fixed = TRUE)
    x <- gsub("\r", "\\r", x, fixed = TRUE)
    x <- gsub("\t", "\\t", x, fixed = TRUE)
    paste0("\"", x, "\"")
  }

  gf$.gf_array <- function(items) paste0("[", paste(items, collapse = ","), "]")

  gf$.gf_plural <- function(n, word) paste(format(n, big.mark = ","), if (n == 1) word else paste0(word, "s"))

  # Describes an object in plain words, as the Objects list shows it.
  gf$.gf_describe <- function(obj) {
    if (is.data.frame(obj)) {
      return(paste0("data frame, ", .gf_plural(nrow(obj), "row"), ", ", .gf_plural(ncol(obj), "column")))
    }
    if (is.matrix(obj)) {
      return(paste0("matrix, ", .gf_plural(nrow(obj), "row"), ", ", .gf_plural(ncol(obj), "column")))
    }
    if (inherits(obj, "lm") && !inherits(obj, "glm")) {
      r2 <- tryCatch(summary(obj)$r.squared, error = function(e) NA)
      if (is.na(r2)) return("linear model")
      return(paste0("linear model, R squared ", format(round(r2, 2), nsmall = 2)))
    }
    if (inherits(obj, "glm")) return(paste0("generalized linear model, ", obj$family$family))
    if (inherits(obj, "htest")) return(paste0("test result, ", obj$method))
    if (is.function(obj)) return("function")
    if (is.factor(obj)) return(paste0("factor, ", .gf_plural(nlevels(obj), "level")))
    if (is.list(obj)) return(paste0("list, ", .gf_plural(length(obj), "item")))
    if (is.atomic(obj)) {
      type <- switch(typeof(obj), double = "numeric", integer = "integer", character = "text",
                     logical = "logical", complex = "complex", typeof(obj))
      if (length(obj) == 1) return(paste0(type, ", ", format(obj, digits = 4)))
      return(paste0(type, ", ", .gf_plural(length(obj), "value")))
    }
    class(obj)[1]
  }

  gf$.gf_kind <- function(obj) {
    if (is.data.frame(obj) || is.matrix(obj)) return("data")
    if (inherits(obj, c("lm", "glm", "htest", "nls", "aov"))) return("model")
    if (is.function(obj)) return("function")
    if (is.list(obj)) return("list")
    "value"
  }

  # Lists the objects in the global environment. Column names come along
  # for data frames so the app can suggest the column someone meant.
  gf$.gf_objects <- function() {
    names <- ls(globalenv(), sorted = TRUE)
    rows <- vapply(names, function(name) {
      obj <- get(name, envir = globalenv())
      cols <- if (is.data.frame(obj)) .gf_array(.gf_str(utils::head(names(obj), 200))) else "[]"
      paste0("{\"name\":", .gf_str(name), ",\"kind\":", .gf_str(.gf_kind(obj)),
             ",\"class\":", .gf_str(class(obj)[1]), ",\"summary\":", .gf_str(.gf_describe(obj)),
             ",\"columns\":", cols, "}")
    }, character(1))
    cat(.gf_array(rows), "\n")
  }

  # Reports which of the named packages are not installed. system.file is
  # far faster than installed.packages, which reads every package.
  gf$.gf_missing <- function(packages) {
    missing <- packages[!vapply(packages, function(p) nzchar(system.file(package = p)), logical(1))]
    cat(.gf_array(.gf_str(missing)), "\n")
  }

  # Sizes new plots to the pane they will appear in. ark reads these options
  # each time it renders, in inches, with the pixel ratio for sharp output
  # on high density displays. ark converts inches at R's own default
  # resolution, 96 per inch on macOS and 72 elsewhere, so the same rule is
  # used here or plots come out at the wrong size off the Mac.
  gf$.gf_plot_size <- function(width_px, height_px, pixel_ratio) {
    dpi <- if (identical(Sys.info()[["sysname"]], "Darwin")) 96 else 72
    options(ark.plot.width = width_px / dpi, ark.plot.height = height_px / dpi,
            ark.plot.pixel_ratio = pixel_ratio)
    cat("true\n")
  }

  # Default colors for new plots, so plots follow the color vision palette
  # chosen in Settings. ggplot2 reads these options when it is installed,
  # and setting them is harmless when it is not.
  gf$.gf_palette <- function(colors) {
    grDevices::palette(colors)
    options(ggplot2.discrete.colour = colors, ggplot2.discrete.fill = colors) # standards: ggplot2 option name
    cat("true\n")
  }

  # The data viewer reads a data frame a page at a time. It asks for a
  # description of every column first: its type, how many values are
  # missing, a short summary, and the bar heights of a small distribution
  # sketch, scaled to 0 to 100.
  gf$.gf_type <- function(col) {
    if (inherits(col, "POSIXt")) return("dttm")
    if (inherits(col, "Date")) return("date")
    if (is.factor(col)) return("fct")
    if (is.integer(col)) return("int")
    if (is.numeric(col)) return("num")
    if (is.character(col)) return("chr")
    if (is.logical(col)) return("lgl")
    if (is.list(col)) return("list")
    class(col)[1]
  }

  gf$.gf_num <- function(x) {
    if (is.na(x) || !is.finite(x)) return("null")
    format(signif(x, 6), scientific = FALSE, trim = TRUE)
  }

  gf$.gf_column <- function(name, col) {
    type <- .gf_type(col)
    missing <- sum(is.na(col))
    present <- col[!is.na(col)]
    stats <- "{}"
    bars <- integer(0)
    top <- "[]"
    if (type %in% c("num", "int") && length(present) > 0) {
      present <- present[is.finite(present)]
      if (length(present) > 0) {
        counts <- graphics::hist(present, breaks = 12, plot = FALSE)$counts
        bars <- round(100 * counts / max(counts))
        stats <- paste0("{\"mean\":", .gf_num(mean(present)), ",\"median\":", .gf_num(stats::median(present)),
                        ",\"sd\":", .gf_num(if (length(present) > 1) stats::sd(present) else NA),
                        ",\"min\":", .gf_num(min(present)), ",\"max\":", .gf_num(max(present)), "}")
      }
      summary <- if (length(present) > 0) paste(format(min(present), big.mark = ","), "to", format(max(present), big.mark = ",")) else "no values"
    } else if (type %in% c("fct", "chr", "lgl")) {
      counts <- sort(table(as.character(present)), decreasing = TRUE)
      shown <- utils::head(counts, 6)
      if (length(shown) > 0) bars <- round(100 * as.numeric(shown) / max(shown))
      top <- .gf_array(vapply(seq_along(shown), function(i) paste0("{\"value\":", .gf_str(names(shown)[i]), ",\"count\":", as.integer(shown[i]), "}"), character(1)))
      summary <- .gf_plural(length(counts), if (type == "fct") "level" else "value")
    } else if (type %in% c("date", "dttm") && length(present) > 0) {
      summary <- paste(format(min(present)), "to", format(max(present)))
    } else {
      summary <- type
    }
    paste0("{\"name\":", .gf_str(name), ",\"type\":", .gf_str(type), ",\"missing\":", missing,
           ",\"summary\":", .gf_str(summary), ",\"bars\":", .gf_array(bars), ",\"stats\":", stats, ",\"top\":", top, "}")
  }

  gf$.gf_frame <- function(name) {
    obj <- get(name, envir = globalenv())
    if (is.matrix(obj)) obj <- as.data.frame(obj)
    if (!is.data.frame(obj)) stop(paste(name, "is not a data frame"))
    obj
  }

  gf$.gf_data_meta <- function(name) {
    df <- .gf_frame(name)
    cols <- vapply(seq_along(df), function(i) .gf_column(names(df)[i], df[[i]]), character(1))
    cat(paste0("{\"name\":", .gf_str(name), ",\"rows\":", nrow(df), ",\"columns\":", .gf_array(cols), "}"), "\n")
  }

  # One page of rows as text, in the order asked for, with a flag for each
  # missing value so the viewer can mark it rather than print NA.
  gf$.gf_data_rows <- function(name, offset, count, sort_by, descending) {
    df <- .gf_frame(name)
    index <- seq_len(nrow(df))
    if (nzchar(sort_by) && sort_by %in% names(df)) index <- order(df[[sort_by]], decreasing = descending, na.last = TRUE)
    index <- index[seq_len(nrow(df)) > offset & seq_len(nrow(df)) <= offset + count]
    page <- df[index, , drop = FALSE]
    cells <- lapply(page, function(col) {
      text <- if (is.list(col)) vapply(col, function(v) paste(format(v), collapse = ", "), character(1)) else format(col, trim = TRUE, big.mark = "")
      text[is.na(col)] <- ""
      text
    })
    na <- lapply(page, function(col) if (is.list(col)) rep(FALSE, length(col)) else is.na(col))
    rows <- vapply(seq_along(index), function(r) {
      values <- vapply(cells, function(col) col[r], character(1))
      flags <- vapply(na, function(col) col[r], logical(1))
      paste0("{\"n\":", index[r], ",\"values\":", .gf_array(.gf_str(values)), ",\"na\":", .gf_array(tolower(as.character(flags))), "}")
    }, character(1))
    cat(.gf_array(rows), "\n")
  }

  # Moves R to the folder of the script being run, so a path such as
  # "data.csv" means the file beside the script, as a new user expects.
  gf$.gf_setwd <- function(dir) {
    setwd(dir)
    cat(.gf_str(getwd()), "\n")
  }

  # Draws a plot again into a file at a chosen size and format, from the
  # code that first drew it. The code runs in a scratch environment, so
  # anything it assigns stays out of the workspace, and the random number
  # state is put back afterward, so exporting never changes later results.
  gf$.gf_export <- function(code, path, format, width, height, res) {
    seed <- if (exists(".Random.seed", envir = globalenv())) get(".Random.seed", envir = globalenv()) else NULL
    previous <- grDevices::dev.cur()
    switch(format,
      png = grDevices::png(path, width = width, height = height, units = "in", res = res),
      pdf = grDevices::pdf(path, width = width, height = height),
      svg = grDevices::svg(path, width = width, height = height))
    device <- grDevices::dev.cur()
    problem <- tryCatch({
      scratch <- new.env(parent = globalenv())
      for (expr in parse(text = code)) {
        shown <- withVisible(eval(expr, scratch))
        # A ggplot appears only when printed, as it is at the console.
        if (shown$visible) print(shown$value)
      }
      ""
    }, error = function(e) conditionMessage(e), finally = {
      grDevices::dev.off(device)
      if (previous > 1) grDevices::dev.set(previous)
      if (!is.null(seed)) assign(".Random.seed", seed, envir = globalenv())
    })
    if (nzchar(problem)) cat(paste0("{\"error\":", .gf_str(problem), "}"), "\n")
    else cat(paste0("{\"path\":", .gf_str(path), "}"), "\n")
  }

  # Code completion, from the engine R's own console uses. It reports where
  # the word being completed starts on the line, and what each candidate
  # is, so the editor can show a fitting icon.
  gf$.gf_complete <- function(line, cursor) {
    env <- utils:::.CompletionEnv
    utils:::.assignLinebuffer(line)
    utils:::.assignEnd(cursor)
    utils:::.guessTokenFromLine()
    utils:::.completeToken()
    items <- unique(utils:::.retrieveCompletions())
    items <- utils::head(items[nzchar(items)], 200)
    kinds <- vapply(items, function(item) {
      if (grepl("=$", item)) return("argument")
      if (grepl("::$", item)) return("package")
      name <- sub("^.*::", "", item)
      value <- tryCatch(get(name, envir = globalenv()), error = function(e) NULL)
      if (is.function(value)) "function" else if (is.data.frame(value)) "data" else "variable"
    }, character(1), USE.NAMES = FALSE)
    rows <- paste0("{\"name\":", .gf_str(items), ",\"kind\":", .gf_str(kinds), "}")
    start <- env[["start"]]
    if (is.null(start)) start <- cursor
    cat(paste0("{\"start\":", start, ",\"items\":", .gf_array(if (length(items)) rows else character(0)), "}"), "\n")
  }

  # A help page as HTML, for the Help pane. A topic is looked up the way
  # ?topic does; a file is a help page named directly, as links between
  # pages name them. When a topic is in more than one attached package, the
  # choices come back instead, as RStudio offers them. R's link database is
  # built once per session and kept, so links between pages work.
  gf$.gf_help <- function(topic, package = "", file = "") {
    if (nzchar(file)) {
      paths <- tryCatch(file.path(find.package(package), "help", file), error = function(e) character(0))
    } else {
      args <- list(topic = topic)
      if (nzchar(package)) args$package <- package
      paths <- tryCatch(as.character(do.call(utils::help, args)), error = function(e) character(0))
    }
    if (!length(paths)) {
      cat("{\"found\":false}", "\n")
      return(invisible(NULL))
    }
    if (length(paths) > 1) {
      choices <- paste0("{\"package\":", .gf_str(basename(dirname(dirname(paths)))), ",\"file\":", .gf_str(basename(paths)), "}")
      cat(paste0("{\"found\":true,\"choices\":", .gf_array(choices), "}"), "\n")
      return(invisible(NULL))
    }
    pkg <- basename(dirname(dirname(paths)))
    # R 4.6 requires the package folder that R 4.3 let callers leave out,
    # so the page's own package is passed, which every version accepts. If
    # the links cannot be built, the page still shows, just without links.
    home <- environment(sys.function())
    if (is.null(home$.links)) {
      links <- tryCatch(tools::findHTMLlinks(pkgDir = dirname(dirname(paths))), error = function(e) character(0))
      assign(".links", links, envir = home)
    }
    rd <- utils:::.getHelpFile(paths)
    html <- paste(utils::capture.output(tools::Rd2HTML(rd, out = "", package = pkg, Links = if (length(home$.links)) home$.links else NULL, Links2 = character())), collapse = "\n")
    cat(paste0("{\"found\":true,\"package\":", .gf_str(pkg), ",\"file\":", .gf_str(basename(paths)), ",\"html\":", .gf_str(html), "}"), "\n")
  }

  # Installed packages for the Packages pane, with whether each is attached.
  gf$.gf_packages <- function() {
    ip <- utils::installed.packages(fields = "Title")
    ip <- ip[!duplicated(ip[, "Package"]), , drop = FALSE]
    ip <- ip[order(tolower(ip[, "Package"])), , drop = FALSE]
    title <- gsub("\\s+", " ", ifelse(is.na(ip[, "Title"]), "", ip[, "Title"]))
    base <- !is.na(ip[, "Priority"]) & ip[, "Priority"] == "base"
    rows <- paste0("{\"name\":", .gf_str(ip[, "Package"]), ",\"version\":", .gf_str(ip[, "Version"]),
                   ",\"title\":", .gf_str(title), ",\"loaded\":", tolower(ip[, "Package"] %in% .packages()),
                   ",\"base\":", tolower(base), "}")
    cat(.gf_array(rows), "\n")
  }

  # The first rows a reading call returns, for the Import Data preview. The
  # call runs in a scratch environment, so nothing it makes is kept, and a
  # failure comes back as a message rather than an error in the console.
  gf$.gf_preview <- function(code, n = 50) {
    value <- tryCatch(eval(parse(text = code), new.env(parent = globalenv())), error = function(e) e)
    if (inherits(value, "error")) {
      cat(paste0("{\"error\":", .gf_str(conditionMessage(value)), "}"), "\n")
      return(invisible(NULL))
    }
    frame <- tryCatch(as.data.frame(value), error = function(e) NULL)
    if (is.null(frame)) {
      cat("{\"error\":\"The file was read, but what it holds is not a table.\"}", "\n")
      return(invisible(NULL))
    }
    page <- utils::head(frame, n)
    types <- vapply(page, .gf_type, character(1))
    cells <- lapply(page, function(column) {
      shown <- tryCatch(format(column, trim = TRUE, justify = "none"), error = function(e) rep("?", length(column)))
      shown[is.na(column)] <- "NA"
      as.character(shown)
    })
    rows <- vapply(seq_len(nrow(page)), function(r) .gf_array(.gf_str(vapply(cells, function(column) column[r], character(1)))), character(1))
    columns <- paste0("{\"name\":", .gf_str(names(page)), ",\"type\":", .gf_str(types), "}")
    cat(paste0("{\"columns\":", .gf_array(columns), ",\"rows\":", .gf_array(rows), "}"), "\n")
  }

  # R's own parser message for code that will not parse, which names the
  # line and column, as in "<text>:2:5: unexpected symbol". The console's
  # message leaves the position out, and the position is what lets the app
  # point at the exact spot. The code is parsed, never run.
  gf$.gf_parse_problem <- function(code) {
    message <- tryCatch({
      parse(text = code, keep.source = FALSE)
      ""
    }, error = function(e) conditionMessage(e))
    cat(paste0("{\"message\":", .gf_str(message), "}"), "\n")
  }

  gf$.gf_info <- function() {
    cat(paste0("{\"version\":", .gf_str(as.character(getRversion())),
               ",\"wd\":", .gf_str(getwd()),
               ",\"repos\":", .gf_str(getOption("repos")[[1]]), "}"), "\n")
  }

  # Each helper looks up its siblings in this environment first, so a person
  # who happens to define a function with the same name cannot break them.
  for (name in ls(gf, all.names = TRUE)) environment(gf[[name]]) <- gf
  attach(gf, name = "tools:goodfor", warn.conflicts = FALSE)
})
invisible(NULL)
"#;

/// Quotes a string as an R literal, so names typed by the person cannot
/// break out of the call we build around them.
pub fn r_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
    format!("\"{escaped}\"")
}

pub fn missing_call(packages: &[String]) -> String {
    let list: Vec<String> = packages.iter().map(|name| r_string(name)).collect();
    format!(".gf_missing(c({}))", list.join(", "))
}

/// Asks for the description of a data frame's columns.
pub fn data_meta_call(name: &str) -> String {
    format!(".gf_data_meta({})", r_string(name))
}

/// Asks for one page of a data frame's rows.
pub fn data_rows_call(name: &str, offset: u32, count: u32, sort_by: &str, descending: bool) -> String {
    let descending = if descending { "TRUE" } else { "FALSE" };
    format!(".gf_data_rows({}, {offset}, {count}, {}, {descending})", r_string(name), r_string(sort_by))
}

/// Asks R to draw a plot again into a file. Sizes are in inches, and the
/// resolution applies to PNG files only.
pub fn export_call(code: &str, path: &str, format: &str, width: f64, height: f64, dpi: u32) -> String {
    format!(".gf_export({}, {}, {}, {width}, {height}, {dpi})", r_string(code), r_string(path), r_string(format))
}

/// Asks R which names could complete the text before the cursor. The cursor
/// is a character offset into the line.
pub fn complete_call(line: &str, cursor: usize) -> String {
    format!(".gf_complete({}, {cursor})", r_string(line))
}

/// Asks for a help page by topic, as ?topic does, or by file name within a
/// package, as links between pages name them.
pub fn help_call(topic: &str, package: &str, file: &str) -> String {
    format!(".gf_help({}, {}, {})", r_string(topic), r_string(package), r_string(file))
}

/// Asks R for the first rows a reading call returns, for the Import Data
/// preview.
pub fn preview_call(code: &str) -> String {
    format!(".gf_preview({})", r_string(code))
}

/// Asks R's parser where code stops making sense, without running it.
pub fn parse_problem_call(code: &str) -> String {
    format!(".gf_parse_problem({})", r_string(code))
}

pub fn setwd_call(dir: &str) -> String {
    format!(".gf_setwd({})", r_string(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_cannot_escape_the_literal() {
        assert_eq!(r_string("a\"); system(\"x"), "\"a\\\"); system(\\\"x\"");
    }

    #[test]
    fn missing_call_lists_every_package() {
        let call = missing_call(&["gt".into(), "dplyr".into()]);
        assert_eq!(call, ".gf_missing(c(\"gt\", \"dplyr\"))");
    }
}
