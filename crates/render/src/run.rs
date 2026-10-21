//! Running a render and following it line by line.
//!
//! The program starts in a process group of its own. Quarto starts R, and R
//! may start more programs, so stopping only Quarto would leave the rest
//! running. Stopping the group ends all of them at once. On Windows the
//! program itself is stopped.

use crate::parse::{self, Failure, Line, OUTPUT_MARKER};
use crate::plan::Plan;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{mpsc, Notify};

/// How a render ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Finished {
    Done,
    Failed(Failure),
}

/// The ending, the files made, and every line printed on the way.
#[derive(Clone, Debug)]
pub struct Outcome {
    pub finished: Finished,
    pub outputs: Vec<PathBuf>,
    pub lines: Vec<String>,
}

/// Asks a running render to stop. It can be pressed before the render has
/// reached the point of listening, and it is still honored.
#[derive(Default)]
pub struct Stopper {
    pressed: AtomicBool,
    notify: Notify,
}

impl Stopper {
    pub fn stop(&self) {
        self.pressed.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }

    fn pressed(&self) -> bool {
        self.pressed.load(Ordering::SeqCst)
    }
}

/// Runs `plan`, calling `on_line` for every line as it arrives, and returns
/// once the program has ended or been stopped.
pub async fn run(plan: &Plan, stopper: Arc<Stopper>, mut on_line: impl FnMut(&str, &Line) + Send) -> std::io::Result<Outcome> {
    let mut made = Vec::new();
    let mut marked = Vec::new();
    let followed = follow(plan, stopper, |text| {
        let line = parse::classify(text, &plan.dir);
        if let Line::Made(path) = &line {
            // R Markdown names each file twice, once relative and once in
            // full after the marker. The full one is kept.
            if text.trim_start().starts_with(OUTPUT_MARKER) { marked.push(path.clone()) } else { made.push(path.clone()) }
        }
        on_line(text, &line);
    })
    .await?;
    let mut outputs = if marked.is_empty() { made } else { marked };
    let mut seen = std::collections::HashSet::new();
    outputs.retain(|path| seen.insert(path.clone()));
    let lines: Vec<String> = followed.lines.into();
    let finished = if followed.stopped {
        Finished::Failed(Failure::Stopped)
    } else if followed.status.success() {
        Finished::Done
    } else {
        Finished::Failed(parse::diagnose(&lines))
    };
    Ok(Outcome { finished, outputs, lines })
}

/// How a program that was followed to its end finished.
pub struct Followed {
    pub status: std::process::ExitStatus,
    /// Whether it ended because Stop was pressed.
    pub stopped: bool,
    /// The latest lines it printed, free of color codes.
    pub lines: VecDeque<String>,
}

/// How many printed lines are kept for working out why a program failed.
/// A Shiny app can run for hours, so the oldest lines are let go, and
/// the reason for a failure is always near the end.
const KEEP_LINES: usize = 5000;

/// Starts the program in `plan` and calls `on_text` with every line it
/// prints, until it ends or `stopper` is pressed. Reports and Shiny apps
/// both run this way and differ only in how they read the lines.
pub async fn follow(plan: &Plan, stopper: Arc<Stopper>, mut on_text: impl FnMut(&str) + Send) -> std::io::Result<Followed> {
    let mut command = tokio::process::Command::new(&plan.program);
    command
        .args(&plan.args)
        .envs(plan.env.iter().map(|(name, value)| (name.as_str(), value.as_os_str())))
        .current_dir(&plan.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;

    // Both streams feed one channel, so lines keep roughly the order the
    // program printed them in.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Some(out) = child.stdout.take() {
        tokio::spawn(forward(out, tx.clone()));
    }
    if let Some(err) = child.stderr.take() {
        tokio::spawn(forward(err, tx.clone()));
    }
    drop(tx);

    let mut lines = VecDeque::new();
    let mut stopped = stopper.pressed();
    // After Stop, the lines are followed only for a short grace period. A
    // process that ignores the request, or one outside the group that still
    // holds the output open, would otherwise keep Stop from ever finishing.
    let mut deadline = None;
    if stopped {
        stop_group(&mut child);
        deadline = Some(tokio::time::Instant::now() + STOP_GRACE);
    }
    loop {
        tokio::select! {
            next = rx.recv() => {
                let Some(raw) = next else { break };
                let text = parse::strip_ansi(&raw);
                on_text(&text);
                if lines.len() == KEEP_LINES {
                    lines.pop_front();
                }
                lines.push_back(text);
            }
            _ = stopper.notify.notified(), if !stopped => {
                stopped = true;
                stop_group(&mut child);
                deadline = Some(tokio::time::Instant::now() + STOP_GRACE);
            }
            _ = tokio::time::sleep_until(deadline.unwrap_or_else(tokio::time::Instant::now)), if deadline.is_some() => break,
        }
    }
    let status = wait_briefly(&mut child, stopped).await?;
    Ok(Followed { status, stopped, lines })
}

/// Sends each line of a stream to the channel. Carriage returns, which
/// progress bars use to redraw a line, also end a line here.
async fn forward(stream: impl AsyncRead + Unpin, tx: mpsc::UnboundedSender<String>) {
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::new();
    while let Ok(read) = reader.read_until(b'\n', &mut buffer).await {
        if read == 0 {
            break;
        }
        let text = String::from_utf8_lossy(&buffer).to_string();
        for part in text.trim_end_matches(['\n', '\r']).split('\r') {
            if tx.send(part.to_string()).is_err() {
                return;
            }
        }
        buffer.clear();
    }
}

/// How long a stopped program gets to end by itself before it is ended
/// without waiting further.
const STOP_GRACE: Duration = Duration::from_secs(2);

/// Asks every process in the render's group to end.
fn stop_group(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: killpg only sends a signal to the group this render
        // created with process_group(0), whose id is the child's own id.
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGTERM);
        }
        return;
    }
    let _ = child.start_kill();
}

/// Waits for the program to end. After Stop, anything still running after
/// the grace period is ended without waiting further.
async fn wait_briefly(child: &mut tokio::process::Child, stopped: bool) -> std::io::Result<std::process::ExitStatus> {
    if !stopped {
        return child.wait().await;
    }
    match tokio::time::timeout(STOP_GRACE, child.wait()).await {
        Ok(status) => status,
        Err(_) => {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                // SAFETY: as above, the signal goes only to this render's
                // own process group.
                unsafe {
                    libc::killpg(pid as libc::pid_t, libc::SIGKILL);
                }
            }
            let _ = child.start_kill();
            child.wait().await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A program that ignores the request to stop is still ended, and Stop
    /// returns instead of waiting on it for good.
    #[cfg(unix)]
    #[tokio::test]
    async fn stop_finishes_when_the_program_ignores_it() {
        let plan = Plan {
            program: PathBuf::from("sh"),
            args: vec!["-c".into(), "trap '' TERM; echo started; sleep 60".into()],
            env: Vec::new(),
            dir: std::env::temp_dir(),
        };
        let stopper = Arc::new(Stopper::default());
        let pressed = stopper.clone();
        let begun = std::time::Instant::now();
        let followed = follow(&plan, stopper, move |_| pressed.stop()).await.unwrap();
        assert!(followed.stopped);
        assert!(begun.elapsed() < Duration::from_secs(20), "Stop took {:?}", begun.elapsed());
    }
}
