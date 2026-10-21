use rsession::{find_installations, parse_helper_json, Event, Session, SessionConfig};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

fn ark_path() -> PathBuf {
    if let Ok(path) = std::env::var("GOODFOR_ARK") {
        return PathBuf::from(path);
    }
    let output = std::process::Command::new("rustc").arg("-vV").output().unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    let triple = text.lines().find_map(|line| line.strip_prefix("host: ")).unwrap().trim().to_string();
    let exe = if cfg!(windows) { ".exe" } else { "" };
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../src-tauri/binaries/ark-{triple}{exe}"));
    assert!(path.exists(), "ark is missing; run `node scripts/fetch-ark.mjs` first");
    path
}

async fn start() -> (Arc<Session>, mpsc::UnboundedReceiver<Event>, tempfile::TempDir) {
    let installs = find_installations();
    assert!(!installs.is_empty(), "no R installation was found");
    let dir = tempfile::tempdir().unwrap();
    let config = SessionConfig {
        ark_path: ark_path(),
        r_home: installs[0].home.clone(),
        working_dir: dir.path().to_path_buf(),
        runtime_dir: dir.path().join(".runtime"),
    };
    let (tx, rx) = mpsc::unbounded_channel();
    let session = Session::start(config, tx).await.expect("session starts");
    (session, rx, dir)
}

/// Collects every event for one run, up to and including its Done.
async fn collect(rx: &mut mpsc::UnboundedReceiver<Event>, run: &str) -> Vec<Event> {
    let mut events = Vec::new();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.expect("event arrives").expect("channel open");
        let done = matches!(&event, Event::Done { run: id, .. } if id == run);
        events.push(event);
        if done {
            return events;
        }
    }
}

fn texts(events: &[Event]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            Event::Stream { text, .. } => Some(text.clone()),
            Event::Output { text: Some(text), .. } => Some(text.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

#[tokio::test]
async fn values_streams_errors_and_plots_reach_the_right_run() {
    let (session, mut rx, _dir) = start().await;

    let run = session.execute("1 + 1").await.unwrap();
    let events = collect(&mut rx, &run).await;
    assert_eq!(texts(&events), "[1] 2");
    assert!(events.contains(&Event::Busy { busy: true }));
    assert!(events.contains(&Event::Done { run: run.clone(), ok: true, stopped: false }));

    // A caller chosen id is used as given, and output is tagged with it.
    let run = session.execute_as("cat('hello\\n')", "run-chosen-1").await.unwrap();
    assert_eq!(run, "run-chosen-1");
    assert!(session.execute_as("1", "bad id!").await.is_err());
    assert_eq!(texts(&collect(&mut rx, &run).await), "hello\n");

    let run = session.execute("stop('boom')").await.unwrap();
    let events = collect(&mut rx, &run).await;
    let error = events.iter().find_map(|event| match event {
        Event::Error { message, .. } => Some(message.clone()),
        _ => None,
    });
    assert!(error.unwrap().contains("boom"));
    assert!(events.contains(&Event::Done { run: run.clone(), ok: false, stopped: false }));

    let run = session.execute("plot(1:10)").await.unwrap();
    let events = collect(&mut rx, &run).await;
    let png = events.iter().find_map(|event| match event {
        Event::Output { png: Some(png), .. } => Some(png.clone()),
        _ => None,
    });
    assert!(png.unwrap().starts_with("iVBORw0KGgo"));
    session.shutdown().await;
}

#[tokio::test]
async fn helper_queries_return_json_and_stay_out_of_the_event_stream() {
    let (session, mut rx, _dir) = start().await;
    let run = session.execute("penguin_like <- data.frame(mass = c(3700, 5076), species = c('a', 'b')); fit <- lm(mass ~ 1, penguin_like)").await.unwrap();
    collect(&mut rx, &run).await;

    let objects = parse_helper_json(&session.query(".gf_objects()").await.unwrap()).unwrap();
    let names: Vec<&str> = objects.as_array().unwrap().iter().map(|o| o["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["fit", "penguin_like"]);
    assert_eq!(objects[1]["summary"], "data frame, 2 rows, 2 columns");
    assert_eq!(objects[1]["columns"][0], "mass");
    assert_eq!(objects[0]["kind"], "model");

    let missing = parse_helper_json(&session.query(".gf_missing(c(\"stats\", \"notapackage\"))").await.unwrap()).unwrap();
    assert_eq!(missing, serde_json::json!(["notapackage"]));

    // Moving R to a script's folder, including one whose name needs quoting.
    let folder = tempfile::tempdir().unwrap();
    let odd = folder.path().join("data \"2026\"");
    std::fs::create_dir(&odd).unwrap();
    let call = rsession::helpers::setwd_call(&odd.to_string_lossy());
    let now = parse_helper_json(&session.query(&call).await.unwrap()).unwrap();
    assert_eq!(std::path::PathBuf::from(now.as_str().unwrap()).canonicalize().unwrap(), odd.canonicalize().unwrap());

    // The data viewer's description of columns, and a sorted page of rows.
    let run = session.execute("viewer_df <- data.frame(id = 1:5, mass = c(3.5, NA, 4.2, 5.1, 3.9), kind = factor(c('a', 'b', 'a', NA, 'a')))").await.unwrap();
    collect(&mut rx, &run).await;
    let meta = parse_helper_json(&session.query(&rsession::helpers::data_meta_call("viewer_df")).await.unwrap()).unwrap();
    assert_eq!(meta["rows"], 5);
    assert_eq!(meta["columns"][1]["type"], "num");
    assert_eq!(meta["columns"][1]["missing"], 1);
    assert_eq!(meta["columns"][1]["stats"]["max"], 5.1);
    assert_eq!(meta["columns"][2]["type"], "fct");
    assert_eq!(meta["columns"][2]["top"][0]["value"], "a");
    assert_eq!(meta["columns"][2]["top"][0]["count"], 3);
    let rows = parse_helper_json(&session.query(&rsession::helpers::data_rows_call("viewer_df", 0, 2, "mass", true)).await.unwrap()).unwrap();
    assert_eq!(rows[0]["n"], 4);
    assert_eq!(rows[0]["values"][1], "5.1");
    let page = parse_helper_json(&session.query(&rsession::helpers::data_rows_call("viewer_df", 0, 5, "", false)).await.unwrap()).unwrap();
    assert_eq!(page[1]["na"][1], true);
    assert_eq!(page[1]["values"][1], "");
    assert!(session.query(&rsession::helpers::data_meta_call("not_there")).await.is_err());

    // Exporting a plot redraws it into a file at the chosen size. Nothing
    // the code assigns reaches the workspace, and the random number state
    // is left as it was, so later results do not change.
    let out = tempfile::tempdir().unwrap();
    let run = session.execute("set.seed(1)").await.unwrap();
    collect(&mut rx, &run).await;
    let pdf = out.path().join("plot.pdf");
    let call = rsession::helpers::export_call("leak <- 1:10\nplot(leak, runif(10))", &pdf.to_string_lossy(), "pdf", 3.5, 3.0, 300);
    let done = parse_helper_json(&session.query(&call).await.unwrap()).unwrap();
    assert!(done.get("path").is_some(), "{done}");
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));
    let png = out.path().join("plot.png");
    let call = rsession::helpers::export_call("hist(c(1, 2, 2, 3))", &png.to_string_lossy(), "png", 2.0, 1.5, 100);
    parse_helper_json(&session.query(&call).await.unwrap()).unwrap();
    let bytes = std::fs::read(&png).unwrap();
    // PNG width and height sit at bytes 16 to 24, in pixels: 2 by 1.5
    // inches at 100 dots per inch.
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 200);
    assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 150);
    let state = parse_helper_json(&session.query("cat(paste0('{\"leak\":', tolower(exists('leak')), ',\"draw\":', round(runif(1), 6), '}'), '\\n')").await.unwrap()).unwrap();
    assert_eq!(state["leak"], false);
    // runif(1) right after set.seed(1) is 0.265509, as if no export ran.
    assert_eq!(state["draw"], 0.265509);
    let broken = rsession::helpers::export_call("plot(not_defined)", &out.path().join("x.pdf").to_string_lossy(), "pdf", 3.0, 3.0, 300);
    let failed = parse_helper_json(&session.query(&broken).await.unwrap()).unwrap();
    assert!(failed["error"].as_str().unwrap().contains("not_defined"));

    // Completion comes from R's own engine: names, arguments inside a
    // call, and columns after a dollar sign, each with its kind.
    let names = parse_helper_json(&session.query(&rsession::helpers::complete_call("summ", 4)).await.unwrap()).unwrap();
    assert_eq!(names["start"], 0);
    assert!(names["items"].as_array().unwrap().iter().any(|item| item["name"] == "summary" && item["kind"] == "function"));
    let args = parse_helper_json(&session.query(&rsession::helpers::complete_call("x <- mean(na", 12)).await.unwrap()).unwrap();
    assert_eq!(args["start"], 10);
    assert!(args["items"].as_array().unwrap().iter().any(|item| item["name"] == "na.rm=" && item["kind"] == "argument"));
    let columns = parse_helper_json(&session.query(&rsession::helpers::complete_call("viewer_df$ma", 12)).await.unwrap()).unwrap();
    assert_eq!(columns["items"][0]["name"], "viewer_df$mass");

    // Help pages come back as HTML with links to other pages, by topic or
    // by file within a package, and an unknown topic says so.
    let sd = parse_helper_json(&session.query(&rsession::helpers::help_call("sd", "", "")).await.unwrap()).unwrap();
    assert_eq!(sd["package"], "stats");
    let html = sd["html"].as_str().unwrap();
    assert!(html.contains("Standard Deviation"));
    assert!(html.contains("../../stats/help/var.html"), "help pages link to each other");
    let mean = parse_helper_json(&session.query(&rsession::helpers::help_call("", "base", "mean")).await.unwrap()).unwrap();
    assert!(mean["html"].as_str().unwrap().contains("Arithmetic Mean"));
    let unknown = parse_helper_json(&session.query(&rsession::helpers::help_call("no_such_topic_here", "", "")).await.unwrap()).unwrap();
    assert_eq!(unknown["found"], false);

    // The Packages pane's list knows which packages are attached.
    let packages = parse_helper_json(&session.query(".gf_packages()").await.unwrap()).unwrap();
    let stats = packages.as_array().unwrap().iter().find(|item| item["name"] == "stats").unwrap();
    assert_eq!(stats["loaded"], true);
    assert_eq!(stats["base"], true);

    // The import preview reads the first rows of a real file, reports each
    // column's type, keeps nothing, and explains a file it cannot read.
    let csv = out.path().join("survey.csv");
    std::fs::write(&csv, "id;score\n1;2,5\n2;NA\n3;-99\n").unwrap();
    let path = csv.to_string_lossy().replace('\\', "/");
    let code = format!("read.csv(\"{path}\", sep = \";\", dec = \",\", na.strings = c(\"NA\", \"-99\"), nrows = 50)");
    let preview = parse_helper_json(&session.query(&rsession::helpers::preview_call(&code)).await.unwrap()).unwrap();
    assert_eq!(preview["columns"][1]["name"], "score");
    assert_eq!(preview["columns"][1]["type"], "num");
    assert_eq!(preview["rows"][0][1], "2.5");
    assert_eq!(preview["rows"][2][1], "NA");
    let missing = parse_helper_json(&session.query(&rsession::helpers::preview_call("read.csv(\"/no/such/file.csv\")")).await.unwrap()).unwrap();
    assert!(missing["error"].as_str().unwrap().contains("cannot open"));

    // A helper that fails reports the failure instead of hanging.
    assert!(session.query("stop('helper failed')").await.is_err());

    // None of that produced visible events.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(rx.try_recv().is_err());
    session.shutdown().await;
}

#[tokio::test]
async fn completeness_uses_the_r_parser() {
    let (session, _rx, _dir) = start().await;
    assert_eq!(session.is_complete("x <- c(1,").await.unwrap(), "incomplete");
    assert_eq!(session.is_complete("x <- c(1, 2)").await.unwrap(), "complete");
    assert_eq!(session.is_complete("ggplot(d) +").await.unwrap(), "incomplete");
    session.shutdown().await;
}

#[tokio::test]
async fn stop_interrupts_a_long_run() {
    let (session, mut rx, _dir) = start().await;
    let run = session.execute_as("Sys.sleep(30)", "long-run").await.unwrap();
    // While that run is in progress its id cannot be used again.
    assert!(session.execute_as("1", "long-run").await.is_err());
    tokio::time::sleep(Duration::from_millis(500)).await;
    let started = std::time::Instant::now();
    session.interrupt().await.unwrap();
    let events = collect(&mut rx, &run).await;
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(events.contains(&Event::Done { run: run.clone(), ok: false, stopped: true }));

    // The session is still usable afterward.
    let run = session.execute("2 * 21").await.unwrap();
    assert_eq!(texts(&collect(&mut rx, &run).await), "[1] 42");
    session.shutdown().await;
}

#[tokio::test]
async fn readline_prompts_reach_the_interface_and_take_an_answer() {
    let (session, mut rx, _dir) = start().await;
    let run = session.execute("answer <- readline('Your name: '); cat('hi', answer)").await.unwrap();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.unwrap().unwrap();
        if let Event::InputRequest { prompt, .. } = event {
            assert_eq!(prompt, "Your name: ");
            break;
        }
    }
    session.send_input("Ada").await.unwrap();
    assert!(texts(&collect(&mut rx, &run).await).contains("hi Ada"));
    session.shutdown().await;
}

#[tokio::test]
async fn a_crash_is_reported_and_does_not_hang_callers() {
    let (session, mut rx, _dir) = start().await;
    // quit() ends the R process the same way a crash would from our side.
    let _ = session.execute("quit(save = 'no', status = 3)").await.unwrap();
    let exited = loop {
        let event = tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.unwrap().unwrap();
        if let Event::Exited { code, .. } = event {
            break code;
        }
    };
    assert_eq!(exited, Some(3));
    assert!(!session.is_running());
    assert!(session.execute("1").await.is_err());
}

#[tokio::test]
async fn plots_render_at_the_requested_pixel_size() {
    let (session, mut rx, _dir) = start().await;
    session.query(".gf_plot_size(560, 420, 2)").await.unwrap();
    let run = session.execute("plot(1:10)").await.unwrap();
    let png = collect(&mut rx, &run)
        .await
        .into_iter()
        .find_map(|event| match event {
            Event::Output { png: Some(png), .. } => Some(png),
            _ => None,
        })
        .unwrap();
    let bytes = rsession::decode_plot(&png).unwrap();
    // A PNG stores its width and height as big endian numbers at bytes 16
    // and 20. At a pixel ratio of 2, both double.
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    assert_eq!((width, height), (1120, 840));
    session.shutdown().await;
}

/// The pictures a run sent, as the plot each belongs to and whether it was
/// an update to one already on screen.
fn pictures(events: &[Event]) -> Vec<(Option<String>, bool)> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::Output { png: Some(_), display_id, update, .. } => Some((display_id.clone(), *update)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_line_that_adds_to_a_plot_arrives_as_an_update_to_it() {
    let (session, mut rx, _dir) = start().await;
    let run = session.execute("plot(1:10)").await.unwrap();
    let first = pictures(&collect(&mut rx, &run).await);
    assert_eq!(first.len(), 1, "plot() sends one picture");
    assert!(!first[0].1, "the first picture is new, not an update");

    // ark sends abline's change as update_display_data. Before it was read,
    // such lines ran and showed nothing.
    let run = session.execute("abline(0, 1)").await.unwrap();
    let events = collect(&mut rx, &run).await;
    let updated = pictures(&events);
    assert!(!updated.is_empty(), "abline() must show the changed plot: {events:?}");
    assert!(updated.iter().all(|(id, update)| *update && id == &first[0].0), "abline() updates the same plot: {updated:?} vs {first:?}");
    assert!(events.contains(&Event::Done { run, ok: true, stopped: false }));

    // With no plot open, R refuses, with the message the app explains.
    session.execute("dev.off()").await.unwrap();
    let run = session.execute("abline(0, 1)").await.unwrap();
    let events = collect(&mut rx, &run).await;
    assert!(events.iter().any(|event| matches!(event, Event::Error { message, .. } if message.contains("plot.new has not been called yet"))), "{events:?}");
}

#[tokio::test]
async fn the_parser_names_the_line_and_column_that_the_console_leaves_out() {
    let (session, mut rx, _dir) = start().await;
    // The console's own message has no position.
    let run = session.execute("a <- 1\nb <- 2 foo").await.unwrap();
    let events = collect(&mut rx, &run).await;
    assert!(events.iter().any(|event| matches!(event, Event::Error { message, .. } if message.contains("unexpected symbol") && !message.contains("<text>"))), "{events:?}");
    // The helper asks R's parser, which has one, and runs nothing.
    let text = session.query(&rsession::helpers::parse_problem_call("a <- 1\nb <- 2 foo")).await.unwrap();
    let message = parse_helper_json(&text).unwrap()["message"].as_str().unwrap().to_string();
    assert!(message.starts_with("<text>:2:8: unexpected symbol"), "{message}");
    let fine = session.query(&rsession::helpers::parse_problem_call("x <- \"a \\\" quote\"")).await.unwrap();
    assert_eq!(parse_helper_json(&fine).unwrap()["message"], "");
}
