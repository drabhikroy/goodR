//! Running a render and following it line by line.
//!
//! The program starts in a process group of its own. Quarto starts R, and R
//! may start more programs, so stopping only Quarto would leave the rest
//! running. Stopping the group ends all of them at once. On Windows the
//! program itself is stopped.

use crate::parse::{self, Failure, Line, OUTPUT_MARKER};
use crate::plan::Plan;
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

    let mut lines = Vec::new();
    let mut made = Vec::new();
    let mut marked = Vec::new();
    let mut stopped = stopper.pressed();
    if stopped {
        stop_group(&mut child);
    }
    loop {
        tokio::select! {
            next = rx.recv() => {
                let Some(raw) = next else { break };
                let text = parse::strip_ansi(&raw);
                let line = parse::classify(&text, &plan.dir);
                if let Line::Made(path) = &line {
                    // R Markdown names each file twice, once relative and
                    // once in full after the marker. The full one is kept.
                    if text.trim_start().starts_with(OUTPUT_MARKER) { marked.push(path.clone()) } else { made.push(path.clone()) }
                }
                on_line(&text, &line);
                lines.push(text);
            }
            _ = stopper.notify.notified(), if !stopped => {
                stopped = true;
                stop_group(&mut child);
            }
        }
    }
    let status = wait_briefly(&mut child, stopped).await?;
    let mut outputs = if marked.is_empty() { made } else { marked };
    let mut seen = std::collections::HashSet::new();
    outputs.retain(|path| seen.insert(path.clone()));
    let finished = if stopped {
        Finished::Failed(Failure::Stopped)
    } else if status.success() {
        Finished::Done
    } else {
        Finished::Failed(parse::diagnose(&lines))
    };
    Ok(Outcome { finished, outputs, lines })
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

/// Waits for the program to end. After Stop, anything still running two
/// seconds later is ended without waiting further.
async fn wait_briefly(child: &mut tokio::process::Child, stopped: bool) -> std::io::Result<std::process::ExitStatus> {
    if !stopped {
        return child.wait().await;
    }
    match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
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
