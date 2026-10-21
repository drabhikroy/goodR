//! Small R functions the app calls behind the scenes.
//!
//! They live in an attached environment named "tools:goodfor", the same way
//! RStudio attaches "tools:rstudio", so they never appear among the user's
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
    # Other control characters, such as the color codes some packages
    # print, are not allowed raw in JSON, so they are written as escapes.
    if (any(grepl("[\\x01-\\x1f]", x, perl = TRUE))) {
      for (code in c(1:8, 11:12, 14:31)) x <- gsub(intToUtf8(code), sprintf("\\u%04x", code), x, fixed = TRUE)
    }
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
      # An object whose value fails to load, such as a promise that errors,
      # is listed as NULL rather than hiding every other object.
      obj <- tryCatch(get(name, envir = globalenv()), error = function(e) NULL)
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

  # Plots that match the app: its background, text, and grid colors, for
  # base graphics through a hook run before each new plot, and for ggplot2
  # through its default theme, set now or when ggplot2 loads. The hooks
  # carry a mark, so turning the style off removes only the app's own and
  # leaves any the user added.
  gf$.gf_plot_style <- function(on, bg, fg, muted, grid) {
    ours <- function(h) isTRUE(attr(h, "goodr"))
    setHook("before.plot.new", Filter(Negate(ours), getHook("before.plot.new")), "replace")
    load_event <- packageEvent("ggplot2", "onLoad")
    setHook(load_event, Filter(Negate(ours), getHook(load_event)), "replace")
    gg <- function(...) {
      if (on) {
        ggplot2::theme_set(ggplot2::theme_minimal(base_size = 13) + ggplot2::theme(
          plot.background = ggplot2::element_rect(fill = bg, color = NA),
          panel.grid = ggplot2::element_line(color = grid),
          text = ggplot2::element_text(color = fg),
          axis.text = ggplot2::element_text(color = muted)))
      } else if (isTRUE(gf$.gf_styled)) {
        ggplot2::theme_set(ggplot2::theme_gray())
      }
    }
    if (on) {
      base <- function() graphics::par(bg = bg, fg = muted, col.axis = muted, col.lab = fg, col.main = fg, col.sub = muted)
      attr(base, "goodr") <- TRUE
      setHook("before.plot.new", base)
      attr(gg, "goodr") <- TRUE
      setHook(load_event, gg)
    }
    if (isNamespaceLoaded("ggplot2")) gg()
    assign(".gf_styled", on, envir = gf)
    cat("true\n")
  }

  # Citations: the BibTeX for a DOI from doi.org, or the works matching a
  # title from Crossref, as text. Only these two addresses are ever asked,
  # and the reply is passed on as it came, to be read by the interface.
  gf$.gf_cite <- function(kind, query) {
    target <- if (identical(kind, "doi")) {
      paste0("https://doi.org/", utils::URLencode(query, reserved = FALSE))
    } else {
      paste0("https://api.crossref.org/works?rows=6&select=DOI,title,author,issued,container-title&query.bibliographic=", utils::URLencode(query, reserved = TRUE))
    }
    accept <- if (identical(kind, "doi")) "application/x-bibtex" else "application/json"
    out <- tryCatch({
      con <- url(target, method = "libcurl", headers = c(Accept = accept, `User-Agent` = "goodR (https://github.com/drabhikroy/goodr)"))
      on.exit(close(con))
      suppressWarnings(paste(readLines(con, warn = FALSE, encoding = "UTF-8"), collapse = "\n"))
    }, error = function(e) structure(conditionMessage(e), class = "gf_error"))
    if (inherits(out, "gf_error")) {
      cat(paste0("{\"ok\":false,\"text\":", .gf_str(unclass(out)), "}"), "\n")
    } else {
      cat(paste0("{\"ok\":true,\"text\":", .gf_str(out), "}"), "\n")
    }
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
      text <- if (is.list(col)) vapply(col, function(v) paste(format(v), collapse = ", "), character(1)) else format(col, trim = TRUE, big.mark = "", justify = "none")
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

  # Undo for runs, and where a run spent its time. The app calls this
  # between runs. Before the first statement of each run it keeps a
  # reference to every object in the workspace. That costs almost nothing,
  # since R copies an object only when it changes, so only what a run
  # changes is held twice, and only until the next run. Around each
  # statement R samples where it spends its time, and when the app says
  # the statement was slow, the samples are summarized for it.
  gf$.gf_runs <- new.env()

  gf$.gf_step <- function(summarize, fresh, keep, profile) {
    runs <- .gf_runs
    out <- "null"
    if (isTRUE(runs$profiling)) {
      utils::Rprof(NULL)
      runs$profiling <- FALSE
      if (summarize) out <- .gf_profile_json(runs$file)
    }
    if (fresh) {
      env <- globalenv()
      runs$snap <- if (keep) mget(ls(env, all.names = TRUE), envir = env) else NULL
    }
    if (profile) {
      if (is.null(runs$file)) runs$file <- tempfile("goodfor-profile-", fileext = ".out")
      utils::Rprof(runs$file, interval = 0.02)
      runs$profiling <- TRUE
    }
    cat(paste0("{\"profile\":", out, "}"), "\n")
  }

  # The functions a run spent its time in, most first, as JSON. Calls that
  # only pass work along, such as eval and tryCatch, are left out, since
  # they say nothing about what to change.
  gf$.gf_profile_json <- function(file) {
    summary <- tryCatch(utils::summaryRprof(file), error = function(e) NULL)
    if (is.null(summary) || !NROW(summary$by.total)) return("[]")
    by <- summary$by.total
    names <- gsub("^\"|\"$", "", rownames(by))
    plumbing <- "^(eval|evalq|withVisible|doTryCatch|tryCatch|tryCatchList|tryCatchOne|withCallingHandlers|try|do.call|force|identity|FUN|lapply|sapply|vapply|Map|mapply|Reduce|NextMethod|UseMethod|standardGeneric|<Anonymous>|source|sys.function)$|^\\.gf_|^cmp|^cb\\$|^genCode|^tryInline|^compiler:"
    keep <- !grepl(plumbing, names)
    by <- by[keep, , drop = FALSE]
    names <- names[keep]
    shown <- utils::head(seq_along(names), 6)
    rows <- paste0("{\"name\":", .gf_str(names[shown]), ",\"seconds\":", by$total.time[shown],
                   ",\"share\":", round(by$total.time[shown] / max(summary$sampling.time, 0.02), 3), "}")
    paste0("{\"sampled\":", summary$sampling.time, ",\"calls\":", .gf_array(rows), "}")
  }

  # Puts the workspace back as it was before the last run: changed objects
  # get their old values, and objects the run made are removed. Objects
  # that change in place, such as environments, cannot be put back, and
  # the app says so in words. The snapshot is used once.
  gf$.gf_undo <- function() {
    runs <- .gf_runs
    if (is.null(runs$snap)) {
      cat("{\"ok\":false}", "\n")
      return(invisible(NULL))
    }
    env <- globalenv()
    before <- runs$snap
    now <- ls(env, all.names = TRUE)
    added <- setdiff(now, names(before))
    changed <- character(0)
    for (name in names(before)) {
      old <- before[[name]]
      same <- exists(name, envir = env, inherits = FALSE) && identical(get(name, envir = env, inherits = FALSE), old)
      if (!same) {
        assign(name, old, envir = env)
        changed <- c(changed, name)
      }
    }
    if (length(added)) rm(list = added, envir = env)
    runs$snap <- NULL
    shown <- function(x) x[!startsWith(x, ".")]
    cat(paste0("{\"ok\":true,\"restored\":", .gf_array(.gf_str(shown(changed))),
               ",\"removed\":", .gf_array(.gf_str(shown(added))), "}"), "\n")
  }

  # A short note on a function for the quick help that shows when the
  # pointer rests on its name: its title from the help page, its package,
  # and how it is called. Only names already defined are looked up.
  gf$.gf_brief <- function(name) {
    fn <- tryCatch(get(name, mode = "function"), error = function(e) NULL)
    if (is.null(fn)) {
      cat("{\"found\":false}", "\n")
      return(invisible(NULL))
    }
    usage <- tryCatch({
      text <- deparse(args(fn), width.cutoff = 500L)
      text <- paste(trimws(text[!grepl("^NULL$", trimws(text))]), collapse = " ")
      sub("^function ", name, text)
    }, error = function(e) "")
    paths <- tryCatch(as.character(do.call(utils::help, list(topic = name))), error = function(e) character(0))
    title <- ""
    pkg <- ""
    if (length(paths)) {
      pkg <- basename(dirname(dirname(paths[1])))
      title <- tryCatch({
        rd <- utils:::.getHelpFile(paths[1])
        tags <- vapply(rd, function(x) attr(x, "Rd_tag"), "")
        gsub("\\s+", " ", trimws(paste(unlist(rd[[which(tags == "\\title")[1]]]), collapse = "")))
      }, error = function(e) "")
    }
    if (!nzchar(pkg)) pkg <- tryCatch(environmentName(environment(fn)), error = function(e) "")
    cat(paste0("{\"found\":true,\"package\":", .gf_str(pkg), ",\"title\":", .gf_str(title),
               ",\"usage\":", .gf_str(usage), "}"), "\n")
  }

  # Tidy code: the code restyled by styler, the tidyverse style, or a note
  # that styler is not installed, or why the code could not be styled,
  # which is usually that it does not parse yet.
  gf$.gf_style <- function(code) {
    if (!requireNamespace("styler", quietly = TRUE)) {
      cat("{\"missing\":true}", "\n")
      return(invisible(NULL))
    }
    out <- tryCatch(paste(styler::style_text(code), collapse = "\n"), error = function(e) structure(conditionMessage(e), class = "gf_error"))
    if (inherits(out, "gf_error")) {
      cat(paste0("{\"missing\":false,\"error\":", .gf_str(unclass(out)), "}"), "\n")
    } else {
      cat(paste0("{\"missing\":false,\"text\":", .gf_str(out), "}"), "\n")
    }
  }

  # Ask for help online: what a forum question needs beside the code. A
  # small sample of each named data frame or vector, written by dput() so
  # anyone can paste it and run it, the R version, the system, and the
  # packages attached with their versions.
  gf$.gf_reprex <- function(names) {
    env <- globalenv()
    data <- list()
    for (name in names) {
      if (!exists(name, envir = env, inherits = FALSE)) next
      obj <- get(name, envir = env)
      # Only data is sampled. A model or a list can be large and slow to
      # write out, and is better described in words in the question.
      if (!is.atomic(obj) && !is.data.frame(obj)) next
      sample <- if (is.data.frame(obj) || is.matrix(obj)) utils::head(obj, 5) else if (length(obj) > 20) obj[seq_len(20)] else obj
      text <- tryCatch(paste(deparse(sample, width.cutoff = 70L, control = c("keepNA", "keepInteger", "niceNames", "showAttributes")), collapse = "\n"), error = function(e) "")
      if (nzchar(text) && nchar(text) <= 4000) data[[name]] <- text
    }
    base <- c("stats", "graphics", "grDevices", "utils", "datasets", "methods", "base")
    attached <- setdiff(sub("^package:", "", grep("^package:", search(), value = TRUE)), base)
    packages <- vapply(attached, function(p) tryCatch(paste(p, as.character(utils::packageVersion(p))), error = function(e) p), "")
    cat(paste0("{\"data\":", if (length(data)) .gf_to_json(data) else "{}",
               ",\"r\":", .gf_str(R.version.string),
               ",\"platform\":", .gf_str(utils::sessionInfo()$running),
               ",\"packages\":", .gf_array(vapply(unname(packages), .gf_str, "")), "}"), "\n")
  }

  # The installed packages with a newer version on CRAN, for the Updates
  # page, or why CRAN could not be asked. The CRAN mirror RStudio uses is
  # set only when R has none, as for Update all.
  gf$.gf_outdated <- function() {
    if (identical(unname(getOption("repos")["CRAN"]), "@CRAN@")) options(repos = c(CRAN = "https://cloud.r-project.org"))
    available <- suppressWarnings(tryCatch(utils::available.packages(), error = function(e) NULL))
    if (is.null(available) || nrow(available) == 0) {
      cat("{\"reached\":false,\"packages\":[]}", "\n")
      return(invisible(NULL))
    }
    old <- tryCatch(utils::old.packages(available = available), error = function(e) NULL)
    # A package installed in two libraries is listed once.
    if (!is.null(old)) old <- old[!duplicated(old[, "Package"]), , drop = FALSE]
    rows <- if (is.null(old)) character(0) else vapply(seq_len(nrow(old)), function(i) {
      paste0("{\"name\":", .gf_str(old[i, "Package"]), ",\"installed\":", .gf_str(old[i, "Installed"]), ",\"available\":", .gf_str(old[i, "ReposVer"]), "}")
    }, "")
    cat(paste0("{\"reached\":true,\"packages\":", .gf_array(rows), "}"), "\n")
  }

  gf$.gf_info <- function() {
    cat(paste0("{\"version\":", .gf_str(as.character(getRversion())),
               ",\"wd\":", .gf_str(getwd()),
               ",\"repos\":", .gf_str(getOption("repos")[[1]]), "}"), "\n")
  }

  # The write-up for a statistical test or model: one sentence in APA
  # style, ready to paste into a paper, and its assumptions checked in
  # plain words. It reads a statement such as t.test(len ~ supp, data =
  # ToothGrowth) or fit <- lm(y ~ x). An assigned result is read as it is.
  # A printed one is computed again, which is safe because these functions
  # only compute. Any other statement is left alone.
  gf$.gf_stats_fns <- c("t.test", "wilcox.test", "chisq.test", "cor.test", "aov", "lm")

  gf$.gf_to_json <- function(x) {
    if (is.null(x)) return("null")
    if (is.list(x)) {
      if (length(x) && !is.null(names(x))) {
        return(paste0("{", paste(paste0(.gf_str(names(x)), ":", vapply(x, .gf_to_json, "")), collapse = ","), "}"))
      }
      return(.gf_array(vapply(x, .gf_to_json, "")))
    }
    if (!length(x) || is.na(x[1])) return("null")
    if (is.logical(x)) return(tolower(as.character(x[1])))
    if (is.numeric(x)) return(if (is.finite(x[1])) format(x[1], digits = 15) else "null")
    .gf_str(x[1])
  }

  # Numbers as APA style writes them: two decimals, p to three with no
  # leading zero, and values that cannot pass one, such as r, without it.
  gf$.gf_apa_p <- function(p) if (is.na(p)) "p = NA" else if (p < 0.001) "p < .001" else paste0("p = ", sub("^0", "", sprintf("%.3f", p)))
  gf$.gf_apa <- function(x, digits = 2) sprintf(paste0("%.", digits, "f"), x)
  gf$.gf_apa_unit <- function(x, digits = 2) sub("^(-?)0\\.", "\\1.", sprintf(paste0("%.", digits, "f"), x))
  gf$.gf_apa_df <- function(df) if (abs(df - round(df)) < 1e-8) as.character(round(df)) else sprintf("%.2f", df)

  # One assumption: what was looked at, whether it holds (NA when there is
  # too little to judge), what was found, and what to do when it does not.
  gf$.gf_check <- function(name, ok, detail, advice = "") list(name = name, ok = ok, detail = detail, advice = advice)

  gf$.gf_normal_check <- function(x, what) {
    x <- x[is.finite(x)]
    name <- paste("Normal shape of", what)
    if (length(x) < 3) return(.gf_check(name, NA, "There are too few values to judge."))
    if (length(x) > 5000) return(.gf_check(name, TRUE, paste("With", length(x), "values, the result hardly depends on the shape of the data.")))
    p <- stats::shapiro.test(x)$p.value
    if (p >= 0.05) return(.gf_check(name, TRUE, paste0("The Shapiro-Wilk test finds no clear departure from a normal shape (", .gf_apa_p(p), ").")))
    .gf_check(name, FALSE, paste0("The Shapiro-Wilk test suggests the shape is not normal (", .gf_apa_p(p), ")."),
      if (length(x) >= 30) "With 30 or more values this matters little, since the test stays accurate." else "With so few values, a rank based test that assumes no shape is safer.")
  }

  gf$.gf_outlier_check <- function(groups) {
    out <- sum(vapply(groups, function(x) length(grDevices::boxplot.stats(x[is.finite(x)])$out), 0))
    if (out == 0) return(.gf_check("Extreme values", TRUE, "No value lies far outside the rest."))
    .gf_check("Extreme values", FALSE, paste(.gf_plural(out, "value"), "lie far outside the rest, as a box plot would mark them."),
      "Check they are real and not typing errors. Report the result with and without them if they change it.")
  }

  # The values a test was given, read from its own arguments: the groups of
  # a formula such as len ~ supp, or the vectors x and y.
  gf$.gf_stats_groups <- function(call) {
    args <- as.list(call)[-1]
    if (!length(args)) return(list())
    keys <- names(args)
    if (is.null(keys)) keys <- rep("", length(args))
    first <- eval(args[[1]], globalenv())
    if (inherits(first, "formula")) {
      data <- if ("data" %in% keys) eval(args[["data"]], globalenv()) else environment(first)
      frame <- stats::model.frame(first, data = data)
      if (ncol(frame) > 1) return(split(frame[[1]], frame[[2]]))
      return(list(frame[[1]]))
    }
    unnamed <- which(keys == "")
    y <- if ("y" %in% keys) eval(args[["y"]], globalenv()) else if (length(unnamed) > 1) eval(args[[unnamed[2]]], globalenv()) else NULL
    Filter(Negate(is.null), list(first, y))
  }

  gf$.gf_stats_t <- function(res, call) {
    groups <- tryCatch(.gf_stats_groups(call), error = function(e) list())
    paired <- isTRUE(tryCatch(eval(call$paired, globalenv()), error = function(e) FALSE))
    welch <- grepl("Welch", res$method)
    d <- NA
    if (length(groups) == 2 && is.numeric(groups[[1]]) && is.numeric(groups[[2]])) {
      a <- groups[[1]][is.finite(groups[[1]])]
      b <- groups[[2]][is.finite(groups[[2]])]
      d <- if (paired && length(a) == length(b)) mean(a - b) / stats::sd(a - b) else
        (mean(a) - mean(b)) / sqrt(((length(a) - 1) * stats::var(a) + (length(b) - 1) * stats::var(b)) / (length(a) + length(b) - 2))
    } else if (length(groups) == 1 && is.numeric(groups[[1]])) {
      mu <- if (is.null(res$null.value)) 0 else res$null.value[[1]]
      a <- groups[[1]][is.finite(groups[[1]])]
      d <- (mean(a) - mu) / stats::sd(a)
    }
    ci <- res$conf.int
    sentence <- paste0("t(", .gf_apa_df(res$parameter[[1]]), ") = ", .gf_apa(res$statistic[[1]]), ", ", .gf_apa_p(res$p.value),
      if (!is.null(ci)) paste0(", 95% CI [", .gf_apa(ci[1]), ", ", .gf_apa(ci[2]), "]") else "",
      if (is.finite(d)) paste0(", d = ", .gf_apa(d)) else "")
    checks <- list()
    if (paired && length(groups) == 2) {
      checks <- c(checks, list(.gf_normal_check(groups[[1]] - groups[[2]], "the differences")))
    } else {
      labels <- if (length(groups) == 2) paste("group", if (is.null(names(groups))) c("1", "2") else names(groups)) else "the values"
      for (k in seq_along(groups)) if (is.numeric(groups[[k]])) checks <- c(checks, list(.gf_normal_check(groups[[k]], labels[k])))
    }
    if (length(groups) == 2 && !paired) {
      ratio <- max(stats::var(groups[[1]], na.rm = TRUE), stats::var(groups[[2]], na.rm = TRUE)) / min(stats::var(groups[[1]], na.rm = TRUE), stats::var(groups[[2]], na.rm = TRUE))
      checks <- c(checks, list(if (welch) .gf_check("Equal spread", TRUE, "This is Welch's test, which does not need the two groups to spread equally.") else if (ratio <= 4)
        .gf_check("Equal spread", TRUE, paste0("The larger variance is ", .gf_apa(ratio, 1), " times the smaller, within the usual limit of 4.")) else
        .gf_check("Equal spread", FALSE, paste0("The larger variance is ", .gf_apa(ratio, 1), " times the smaller."), "Leave out var.equal = TRUE, so R uses Welch's test, which allows for it.")))
    }
    if (length(groups)) checks <- c(checks, list(.gf_outlier_check(groups)))
    list(found = TRUE, title = res$method, sentence = sentence, checks = checks)
  }

  gf$.gf_stats_wilcox <- function(res) {
    letter <- names(res$statistic)
    list(found = TRUE, title = res$method, sentence = paste0(letter, " = ", .gf_apa(res$statistic[[1]], if (letter %in% c("W", "V")) 1 else 2), ", ", .gf_apa_p(res$p.value)),
      checks = list(.gf_check("Normal shape", TRUE, "A rank based test like this one does not assume any shape.")))
  }

  gf$.gf_stats_chisq <- function(res) {
    observed <- res$observed
    n <- sum(observed)
    expected <- res$expected
    v <- if (is.matrix(observed) && min(dim(observed)) > 1) sqrt(res$statistic[[1]] / (n * (min(dim(observed)) - 1))) else NA
    sentence <- paste0("χ²(", .gf_apa_df(res$parameter[[1]]), ", N = ", n, ") = ", .gf_apa(res$statistic[[1]]), ", ", .gf_apa_p(res$p.value),
      if (is.finite(v)) paste0(", V = ", .gf_apa_unit(v)) else "")
    small <- mean(expected < 5)
    check <- if (all(expected >= 5)) .gf_check("Expected counts", TRUE, "Every cell expects at least 5 cases.") else if (small <= 0.2 && all(expected >= 1))
      .gf_check("Expected counts", TRUE, paste0(round(small * 100), "% of cells expect fewer than 5 cases, within the usual limit of 20%.")) else
      .gf_check("Expected counts", FALSE, paste0(round(small * 100), "% of cells expect fewer than 5 cases."), "Use fisher.test() on the same table, which is exact for small counts.")
    list(found = TRUE, title = res$method, sentence = sentence, checks = list(check))
  }

  gf$.gf_stats_cor <- function(res, call) {
    pearson <- grepl("Pearson", res$method)
    est <- res$estimate[[1]]
    sentence <- if (pearson) paste0("r(", .gf_apa_df(res$parameter[[1]]), ") = ", .gf_apa_unit(est), ", ", .gf_apa_p(res$p.value),
      if (!is.null(res$conf.int)) paste0(", 95% CI [", .gf_apa_unit(res$conf.int[1]), ", ", .gf_apa_unit(res$conf.int[2]), "]") else "") else
      paste0(if (grepl("Kendall", res$method)) "τ" else "rₛ", " = ", .gf_apa_unit(est), ", ", .gf_apa_p(res$p.value))
    checks <- list()
    if (pearson) {
      groups <- tryCatch(.gf_stats_groups(call), error = function(e) list())
      if (length(groups) == 2) checks <- list(.gf_normal_check(groups[[1]], "the first variable"), .gf_normal_check(groups[[2]], "the second variable"), .gf_outlier_check(groups))
    } else {
      checks <- list(.gf_check("Normal shape", TRUE, "A rank correlation like this one does not assume any shape."))
    }
    list(found = TRUE, title = res$method, sentence = sentence, checks = checks)
  }

  # Spread of residuals: whether their size grows with the fitted values,
  # by regressing the squared residuals on them (the Breusch-Pagan idea).
  gf$.gf_spread_check <- function(fit) {
    r <- stats::residuals(fit)
    f <- stats::fitted(fit)
    if (length(unique(f)) < 3) return(.gf_check("Equal spread", NA, "There are too few distinct fitted values to judge."))
    aux <- summary(stats::lm(I(r^2) ~ f))
    stat <- length(r) * aux$r.squared
    p <- stats::pchisq(stat, 1, lower.tail = FALSE)
    if (p >= 0.05) return(.gf_check("Equal spread", TRUE, paste0("The residuals spread about evenly across the fitted values (", .gf_apa_p(p), ").")))
    .gf_check("Equal spread", FALSE, paste0("The residuals spread more for some fitted values than others (", .gf_apa_p(p), ")."),
      "Standard errors may be off. The sandwich package gives ones that allow for uneven spread.")
  }

  gf$.gf_influence_check <- function(fit) {
    cook <- stats::cooks.distance(fit)
    cut <- 4 / length(cook)
    big <- sum(cook > cut, na.rm = TRUE)
    if (big == 0) return(.gf_check("Influential points", TRUE, "No single case pulls the fit much on its own."))
    worst <- names(which.max(cook))
    .gf_check("Influential points", big <= max(1, length(cook) * 0.05), paste0(.gf_plural(big, "case"), " pull the fit more than usual (Cook's distance above ", .gf_apa(cut), "). The strongest is row ", worst, "."),
      "Look at those rows. Refit without them to see whether the result changes.")
  }

  gf$.gf_stats_lm <- function(fit) {
    s <- summary(fit)
    fs <- s$fstatistic
    p <- if (is.null(fs)) NA else stats::pf(fs[1], fs[2], fs[3], lower.tail = FALSE)
    sentence <- if (is.null(fs)) paste0("R² = ", .gf_apa_unit(s$r.squared)) else
      paste0("F(", fs[2], ", ", fs[3], ") = ", .gf_apa(fs[1]), ", ", .gf_apa_p(p), ", R² = ", .gf_apa_unit(s$r.squared), ", adjusted R² = ", .gf_apa_unit(s$adj.r.squared))
    coefs <- s$coefficients
    terms <- lapply(seq_len(min(nrow(coefs), 8)), function(k) list(
      term = rownames(coefs)[k],
      sentence = paste0("b = ", .gf_apa(coefs[k, 1]), ", SE = ", .gf_apa(coefs[k, 2]), ", t(", s$df[2], ") = ", .gf_apa(coefs[k, 3]), ", ", .gf_apa_p(coefs[k, 4]))))
    checks <- list(.gf_normal_check(stats::residuals(fit), "the residuals"), .gf_spread_check(fit), .gf_influence_check(fit))
    x <- stats::model.matrix(fit)[, -1, drop = FALSE]
    if (ncol(x) > 1) {
      vif <- vapply(seq_len(ncol(x)), function(j) 1 / (1 - summary(stats::lm(x[, j] ~ x[, -j]))$r.squared), 0)
      worst <- max(vif)
      checks <- c(checks, list(if (worst < 5) .gf_check("Predictors overlap", TRUE, paste0("The predictors are distinct enough (largest VIF ", .gf_apa(worst, 1), ").")) else
        .gf_check("Predictors overlap", FALSE, paste0(colnames(x)[which.max(vif)], " overlaps strongly with the other predictors (VIF ", .gf_apa(worst, 1), ")."), "Its own estimate is unstable. Consider dropping or combining overlapping predictors.")))
    }
    list(found = TRUE, title = "Linear model", sentence = sentence, terms = terms, checks = checks)
  }

  gf$.gf_stats_aov <- function(fit) {
    table <- summary(fit)[[1]]
    rows <- trimws(rownames(table))
    resid <- which(rows == "Residuals")
    total <- sum(table[["Sum Sq"]])
    effects <- setdiff(seq_along(rows), resid)
    terms <- lapply(effects, function(k) list(
      term = rows[k],
      sentence = paste0("F(", table[k, "Df"], ", ", table[resid, "Df"], ") = ", .gf_apa(table[k, "F value"]), ", ", .gf_apa_p(table[k, "Pr(>F)"]),
        ", η² = ", .gf_apa_unit(table[k, "Sum Sq"] / total))))
    checks <- list(.gf_normal_check(stats::residuals(fit), "the residuals"))
    frame <- stats::model.frame(fit)
    if (ncol(frame) == 2 && is.factor(frame[[2]])) {
      p <- stats::fligner.test(stats::residuals(fit), frame[[2]])$p.value
      checks <- c(checks, list(if (p >= 0.05) .gf_check("Equal spread", TRUE, paste0("The groups spread about equally (Fligner-Killeen ", .gf_apa_p(p), ").")) else
        .gf_check("Equal spread", FALSE, paste0("The groups spread unequally (Fligner-Killeen ", .gf_apa_p(p), ")."), "oneway.test() compares the means without assuming equal spread.")))
    }
    list(found = TRUE, title = "Analysis of variance", sentence = if (length(terms)) terms[[1]]$sentence else "", terms = if (length(terms) > 1) terms else list(), checks = checks)
  }

  gf$.gf_stats_read <- function(code) {
    parsed <- tryCatch(parse(text = code, keep.source = FALSE), error = function(e) NULL)
    if (length(parsed) != 1) return(list(found = FALSE))
    e <- parsed[[1]]
    name <- NULL
    if (is.call(e) && (identical(e[[1]], as.name("<-")) || identical(e[[1]], as.name("="))) && is.name(e[[2]])) {
      name <- as.character(e[[2]])
      e <- e[[3]]
    }
    if (!is.call(e) || !is.name(e[[1]]) || !(as.character(e[[1]]) %in% .gf_stats_fns)) return(list(found = FALSE))
    fn <- as.character(e[[1]])
    res <- if (!is.null(name) && exists(name, envir = globalenv())) get(name, envir = globalenv()) else eval(e, globalenv())
    switch(fn,
      t.test = .gf_stats_t(res, e),
      wilcox.test = .gf_stats_wilcox(res),
      chisq.test = .gf_stats_chisq(res),
      cor.test = .gf_stats_cor(res, e),
      lm = .gf_stats_lm(res),
      aov = .gf_stats_aov(res))
  }

  gf$.gf_stats <- function(code) {
    out <- tryCatch(suppressWarnings(.gf_stats_read(code)), error = function(e) list(found = FALSE))
    cat(.gf_to_json(out), "\n")
  }

  # Whether a student's result matches the answer's, and when it does not,
  # how it differs, in words a learner can act on: the kind of object, its
  # size, or its values.
  gf$.gf_same <- function(mine, expected) {
    if (isTRUE(all.equal(mine, expected, check.attributes = FALSE))) return(TRUE)
    # Whole and decimal numbers count as the same kind here.
    if (!identical(class(mine)[1], class(expected)[1]) && !(is.numeric(mine) && is.numeric(expected))) {
      return(paste0("Yours is ", .gf_describe(mine), ". The exercise expects ", .gf_describe(expected), "."))
    }
    if (is.data.frame(expected) || is.matrix(expected)) {
      if (nrow(mine) != nrow(expected)) return(paste0("It has ", .gf_plural(nrow(mine), "row"), ", and the exercise expects ", .gf_plural(nrow(expected), "row"), "."))
      if (ncol(mine) != ncol(expected)) return(paste0("It has ", .gf_plural(ncol(mine), "column"), ", and the exercise expects ", .gf_plural(ncol(expected), "column"), "."))
      return("It has the right size, but some of its values differ.")
    }
    if (length(mine) != length(expected)) return(paste0("It has ", .gf_plural(length(mine), "value"), ", and the exercise expects ", .gf_plural(length(expected), "value"), "."))
    if (is.atomic(mine) && length(mine) == 1) return(paste0("It is ", format(mine, digits = 4), ", and the exercise expects ", format(expected, digits = 4), "."))
    "It has the right size, but some of its values differ."
  }

  # Checks an exercise: runs the answer in an environment of its own, on
  # top of the student's objects, and compares. An answer that makes an
  # object is checked by that object in the student's workspace, so any
  # correct way of making it counts. Otherwise the two values are compared.
  # Plots go to a device that draws nothing, and the student's own device
  # is put back after.
  gf$.gf_exercise <- function(student, answer) {
    device <- grDevices::dev.cur()
    grDevices::pdf(NULL)
    on.exit({
      grDevices::dev.off()
      if (device > 1) grDevices::dev.set(device)
    })
    out <- tryCatch({
      env <- new.env(parent = globalenv())
      expected <- withVisible(eval(parse(text = answer), env))
      made <- ls(env, all.names = TRUE)
      if (length(made)) {
        verdict <- list(ok = TRUE, message = "")
        for (name in made) {
          if (!exists(name, envir = globalenv(), inherits = FALSE)) {
            verdict <- list(ok = FALSE, message = paste0("The exercise makes an object called ", name, ". Assign your result to that name."))
            break
          }
          same <- .gf_same(get(name, envir = globalenv()), get(name, envir = env))
          if (!isTRUE(same)) {
            verdict <- list(ok = FALSE, message = paste(name, "is not what the exercise asks for yet.", same))
            break
          }
        }
        verdict
      } else if (is.null(expected$value) && !expected$visible) {
        list(ok = NA, message = "This exercise draws something rather than making a value, so it cannot be checked. Compare yours with what the exercise describes.")
      } else {
        mine <- eval(parse(text = student), new.env(parent = globalenv()))
        same <- .gf_same(mine, expected$value)
        if (isTRUE(same)) list(ok = TRUE, message = "") else list(ok = FALSE, message = paste("The result is not what the exercise asks for yet.", same))
      }
    }, error = function(e) list(ok = NA, message = paste("The answer could not be checked here:", conditionMessage(e))))
    cat(.gf_to_json(out), "\n")
  }

  # Each helper looks up its siblings in this environment first, so a person
  # who happens to define a function with the same name cannot break them.
  for (name in ls(gf, all.names = TRUE)) environment(gf[[name]]) <- gf
  attach(gf, name = "tools:goodfor", warn.conflicts = FALSE)
})
invisible(NULL)
"#;

/// Quotes a string as an R literal, so names typed by the user cannot
/// break out of the call we build around them. A NUL cannot appear in an R
/// string at all, so it is dropped rather than left to fail the whole call.
pub fn r_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r").replace('\0', "");
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

/// Marks the boundary between runs: stops sampling the statement before,
/// summarizing it when it was slow, keeps the objects before a new run
/// when undo is on, and starts sampling the next statement.
pub fn step_call(summarize: bool, fresh: bool, keep: bool, profile: bool) -> String {
    let flag = |value: bool| if value { "TRUE" } else { "FALSE" };
    format!(".gf_step({}, {}, {}, {})", flag(summarize), flag(fresh), flag(keep), flag(profile))
}

/// The call that turns the app's plot style on or off. Colors are checked
/// as hex values such as #1F5F8B before they are written into it.
pub fn plot_style_call(on: bool, colors: &[String]) -> Option<String> {
    let valid = colors.len() == 4 && colors.iter().all(|color| color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit()));
    if !valid {
        return None;
    }
    let list: Vec<String> = colors.iter().map(|color| format!("\"{color}\"")).collect();
    Some(format!(".gf_plot_style({}, {})", if on { "TRUE" } else { "FALSE" }, list.join(", ")))
}

/// Asks R to look up a citation: `kind` is "doi" or "search".
pub fn cite_call(kind: &str, query: &str) -> Option<String> {
    matches!(kind, "doi" | "search").then(|| format!(".gf_cite({}, {})", r_string(kind), r_string(query)))
}

/// Asks R to restyle code with styler, for Tidy code.
pub fn style_call(code: &str) -> String {
    format!(".gf_style({})", r_string(code))
}

/// Asks for the quick help shown when the pointer rests on a function.
/// Asks R whether a student's statement gives what an exercise's answer
/// gives.
pub fn exercise_call(student: &str, answer: &str) -> String {
    format!(".gf_exercise({}, {})", r_string(student), r_string(answer))
}

/// Asks for the write-up of the test or model a statement runs, if any.
pub fn stats_call(code: &str) -> String {
    format!(".gf_stats({})", r_string(code))
}

/// Asks for data samples and versions for a forum question. Only plain R
/// names are passed on, so nothing else reaches R.
pub fn reprex_call(names: &[String]) -> String {
    let list: Vec<String> = names.iter().filter(|name| is_plain_name(name)).map(|name| r_string(name)).collect();
    format!(".gf_reprex(c({}))", list.join(", "))
}

/// A syntactic R name: a letter or dot, then letters, digits, dots, and
/// underscores.
fn is_plain_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '.') && chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
}

pub fn brief_call(name: &str) -> String {
    format!(".gf_brief({})", r_string(name))
}

pub fn setwd_call(dir: &str) -> String {
    format!(".gf_setwd({})", r_string(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reprex_passes_only_plain_names() {
        let names = vec!["stars".to_string(), "x); system(1".to_string(), ".hidden".to_string(), "1a".to_string()];
        assert_eq!(reprex_call(&names), ".gf_reprex(c(\"stars\", \".hidden\"))");
    }

    #[test]
    fn quotes_cannot_escape_the_literal() {
        assert_eq!(r_string("a\"); system(\"x"), "\"a\\\"); system(\\\"x\"");
    }

    #[test]
    fn carriage_returns_and_nuls_stay_inside_the_literal() {
        assert_eq!(r_string("a\r\0b"), "\"a\\rb\"");
    }

    #[test]
    fn step_call_passes_each_choice() {
        assert_eq!(step_call(true, false, true, false), ".gf_step(TRUE, FALSE, TRUE, FALSE)");
    }

    #[test]
    fn missing_call_lists_every_package() {
        let call = missing_call(&["gt".into(), "dplyr".into()]);
        assert_eq!(call, ".gf_missing(c(\"gt\", \"dplyr\"))");
    }
}
