//! One running R session: the ark process plus the sockets we talk to it on.
//!
//! ark runs as its own process, so if R crashes the app stays open and can
//! offer a restart. Every request we send gets an id, and ark tags each piece
//! of output with the id of the request that produced it. That lets output
//! land under the exact line that made it, and lets the app run its own small
//! helper queries without them ever appearing in the console.

use crate::connection::ConnectionInfo;
use crate::wire::{Message, Signer};
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Mutex};
use zeromq::util::PeerIdentity;
use zeromq::{DealerSocket, Socket, SocketOptions, SocketRecv, SocketSend, SubSocket, ZmqMessage};

/// How long R gets to start before we report a problem. A first start can
/// be slow while the operating system checks a freshly installed binary.
const START_TIMEOUT: Duration = Duration::from_secs(60);

/// Request and reply exchanges that should be instant, such as asking
/// whether code is complete.
const QUICK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug)]
pub struct SessionConfig {
    pub ark_path: PathBuf,
    pub r_home: PathBuf,
    pub working_dir: PathBuf,
    /// Holds the connection file and ark's log for this session.
    pub runtime_dir: PathBuf,
}

/// Everything the interface needs to hear about, in the order it happened.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    /// The session is busy whenever at least one visible run is in progress.
    Busy { busy: bool },
    Stream { run: String, name: String, text: String },
    /// A value or a plot. Only the formats present are filled in. A line
    /// that adds to a plot already on screen, such as abline or lines, comes
    /// as an update to that plot: `update` is true and `display_id` names the
    /// plot it changes, so the interface can redraw it in place.
    Output {
        run: String,
        text: Option<String>,
        html: Option<String>,
        png: Option<String>,
        svg: Option<String>,
        #[serde(rename = "displayId")]
        display_id: Option<String>,
        update: bool,
    },
    Error { run: String, message: String, traceback: Vec<String> },
    /// `stopped` is true when the run ended because the user pressed Stop.
    /// ark reports an interrupted run as successful, so we track it ourselves.
    Done { run: String, ok: bool, stopped: bool },
    /// R called readline(), menu(), or similar and is waiting for an answer.
    InputRequest { run: String, prompt: String, password: bool },
    /// The R process ended. `log` holds the end of ark's log to explain why.
    Exited { code: Option<i32>, log: String },
}

/// Bookkeeping for one execute request until both its idle status and its
/// reply have arrived. Either can come first.
struct Run {
    visible: bool,
    stopped: bool,
    idle: bool,
    ok: Option<bool>,
    stdout: String,
    error: Option<String>,
    waiter: Option<oneshot::Sender<Result<String>>>,
}

struct Shared {
    signer: Signer,
    session_id: String,
    events: mpsc::UnboundedSender<Event>,
    replies: StdMutex<HashMap<String, oneshot::Sender<Message>>>,
    runs: StdMutex<HashMap<String, Run>>,
    pending_input: StdMutex<Option<Message>>,
    visible_active: AtomicUsize,
    iopub_live: AtomicBool,
    exited: AtomicBool,
}

pub struct Session {
    shared: Arc<Shared>,
    shell: Mutex<zeromq::DealerSendHalf>,
    control: Mutex<zeromq::DealerSendHalf>,
    stdin: Mutex<zeromq::DealerSendHalf>,
    kill: StdMutex<Option<oneshot::Sender<()>>>,
    pub log_path: PathBuf,
}

impl Session {
    /// Starts ark with the chosen R and waits until R answers.
    pub async fn start(config: SessionConfig, events: mpsc::UnboundedSender<Event>) -> Result<Arc<Session>> {
        std::fs::create_dir_all(&config.runtime_dir)?;
        let info = ConnectionInfo::generate()?;
        let connection_file = config.runtime_dir.join("connection.json");
        info.write(&connection_file)?;
        let log_path = config.runtime_dir.join("ark.log");
        let log = std::fs::File::create(&log_path)?;

        // Console mode is what Positron uses for its console. It keeps
        // readline and menu prompts on the stdin channel and renders plots
        // as images in the output, which is what inline output needs.
        let mut command = tokio::process::Command::new(&config.ark_path);
        command
            .arg("--connection_file")
            .arg(&connection_file)
            .args(["--session-mode", "console"])
            .current_dir(&config.working_dir)
            .env("R_HOME", &config.r_home)
            // ark is quiet unless something goes wrong, which keeps the log
            // short enough to show someone when R fails to start.
            .env("RUST_LOG", "error")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log))
            .kill_on_drop(true);
        // On Linux the loader must be able to find libR before ark opens it.
        if cfg!(target_os = "linux") {
            command.env("LD_LIBRARY_PATH", config.r_home.join("lib"));
        }
        let child = command.spawn().with_context(|| format!("could not start {}", config.ark_path.display()))?;

        // State shared between the socket readers and the public methods.
        // Readers run on their own tasks, so everything here is locked or
        // atomic.
        let shared = Arc::new(Shared {
            signer: Signer::new(&info.key),
            session_id: uuid::Uuid::new_v4().to_string(),
            events,
            replies: StdMutex::new(HashMap::new()),
            runs: StdMutex::new(HashMap::new()),
            pending_input: StdMutex::new(None),
            visible_active: AtomicUsize::new(0),
            iopub_live: AtomicBool::new(false),
            exited: AtomicBool::new(false),
        });

        let (kill_tx, kill_rx) = oneshot::channel();
        spawn_exit_watcher(child, kill_rx, Arc::clone(&shared), log_path.clone());

        // Subscribe before connecting so no early output is filtered away.
        let mut iopub = SubSocket::new();
        iopub.subscribe("").await?;
        iopub.connect(&info.endpoint(info.iopub_port)).await?;
        // ark sends readline prompts on the stdin channel to the identity that
        // made the request on the shell channel, so both share one identity.
        let identity = uuid::Uuid::new_v4().to_string();
        let (shell_tx, shell_rx) = connect_dealer(&info, info.shell_port, Some(&identity)).await?;
        let (control_tx, control_rx) = connect_dealer(&info, info.control_port, None).await?;
        let (stdin_tx, stdin_rx) = connect_dealer(&info, info.stdin_port, Some(&identity)).await?;

        spawn_iopub_reader(iopub, Arc::clone(&shared));
        spawn_reply_reader(shell_rx, Arc::clone(&shared));
        spawn_reply_reader(control_rx, Arc::clone(&shared));
        spawn_stdin_reader(stdin_rx, Arc::clone(&shared));

        let session = Arc::new(Session {
            shared,
            shell: Mutex::new(shell_tx),
            control: Mutex::new(control_tx),
            stdin: Mutex::new(stdin_tx),
            kill: StdMutex::new(Some(kill_tx)),
            log_path,
        });
        session.wait_until_ready().await?;
        session.query(crate::helpers::SOURCE).await.context("could not load the app's R helpers")?;
        Ok(session)
    }

    /// R is ready once it answers on the shell channel and its output channel
    /// is delivering. The second check matters because a subscriber that
    /// connects late silently misses messages, and the first run's output
    /// would vanish.
    async fn wait_until_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + START_TIMEOUT;
        while tokio::time::Instant::now() < deadline {
            if self.shared.exited.load(Ordering::SeqCst) {
                return Err(anyhow!("R stopped while starting:\n{}", log_tail(&self.log_path)));
            }
            let request = Message::new("kernel_info_request", &self.shared.session_id, json!({}));
            if let Ok(reply) = self.request(&self.shell, request, Duration::from_secs(2)).await {
                if reply.msg_type() == "kernel_info_reply" && self.shared.iopub_live.load(Ordering::SeqCst) {
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        Err(anyhow!("R did not start within {} seconds:\n{}", START_TIMEOUT.as_secs(), log_tail(&self.log_path)))
    }

    /// Runs code the user asked for. Output arrives as events tagged with
    /// the returned run id.
    pub async fn execute(&self, code: &str) -> Result<String> {
        self.send_execute(code, true, None, None).await
    }

    /// Like `execute`, with a run id chosen by the caller. Output can arrive
    /// before a call returns, so a caller that must match output to runs
    /// without gaps picks the id first.
    pub async fn execute_as(&self, code: &str, run_id: &str) -> Result<String> {
        if run_id.is_empty() || run_id.len() > 64 || !run_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(anyhow!("run ids are letters, digits, and hyphens, at most 64 long"));
        }
        if self.shared.runs.lock().unwrap().contains_key(run_id) {
            return Err(anyhow!("run id {run_id} is already in use"));
        }
        self.send_execute(code, true, None, Some(run_id)).await
    }

    /// Runs one of the app's own R calls and returns what it printed. These
    /// runs never reach the console and do not change the busy indicator.
    pub async fn query(&self, code: &str) -> Result<String> {
        let (tx, rx) = oneshot::channel();
        self.send_execute(code, false, Some(tx), None).await?;
        rx.await.map_err(|_| anyhow!("R stopped before answering"))?
    }

    async fn send_execute(&self, code: &str, visible: bool, waiter: Option<oneshot::Sender<Result<String>>>, run_id: Option<&str>) -> Result<String> {
        if self.shared.exited.load(Ordering::SeqCst) {
            return Err(anyhow!("R is not running"));
        }
        // Helper queries skip history so they never appear when someone
        // presses the up arrow in the console, and they never ask for input
        // because no one is there to answer.
        let content = json!({
            "code": code,
            "silent": false,
            "store_history": visible,
            "user_expressions": {},
            "allow_stdin": visible,
            "stop_on_error": true,
        });
        let msg = match run_id {
            Some(id) => Message::with_id(id, "execute_request", &self.shared.session_id, content),
            None => Message::new("execute_request", &self.shared.session_id, content),
        };
        let run_id = msg.msg_id().to_string();
        self.shared.runs.lock().unwrap().insert(
            run_id.clone(),
            Run { visible, stopped: false, idle: false, ok: None, stdout: String::new(), error: None, waiter },
        );
        // A run whose request never left is forgotten, so nothing waits on it.
        if let Err(error) = self.send(&self.shell, &msg).await {
            self.shared.runs.lock().unwrap().remove(&run_id);
            return Err(error);
        }
        Ok(run_id)
    }

    /// Asks R's own parser whether `code` is a whole statement. Returns
    /// "complete", "incomplete", "invalid", or "unknown".
    pub async fn is_complete(&self, code: &str) -> Result<String> {
        let msg = Message::new("is_complete_request", &self.shared.session_id, json!({ "code": code }));
        let reply = self.request(&self.shell, msg, QUICK_TIMEOUT).await?;
        Ok(reply.content["status"].as_str().unwrap_or("unknown").to_string())
    }

    /// Stops whatever R is doing, the way Stop or Command period does.
    pub async fn interrupt(&self) -> Result<()> {
        // Marked before sending, because the reply and the final status
        // can arrive before this function returns.
        for run in self.shared.runs.lock().unwrap().values_mut() {
            run.stopped = true;
        }
        let msg = Message::new("interrupt_request", &self.shared.session_id, json!({}));
        self.request(&self.control, msg, QUICK_TIMEOUT).await.map(|_| ())
    }

    /// Answers a pending readline() or menu() prompt.
    pub async fn send_input(&self, value: &str) -> Result<()> {
        let parent = self.shared.pending_input.lock().unwrap().take().ok_or_else(|| anyhow!("R is not waiting for input"))?;
        let reply = Message::reply_to(&parent, "input_reply", &self.shared.session_id, json!({ "value": value }));
        self.send(&self.stdin, &reply).await
    }

    /// Asks R to quit, and ends the process if it has not quit shortly after.
    pub async fn shutdown(&self) {
        if !self.shared.exited.load(Ordering::SeqCst) {
            let msg = Message::new("shutdown_request", &self.shared.session_id, json!({ "restart": false }));
            let _ = self.request(&self.control, msg, Duration::from_secs(2)).await;
            for _ in 0..20 {
                if self.shared.exited.load(Ordering::SeqCst) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        if let Some(kill) = self.kill.lock().unwrap().take() {
            let _ = kill.send(());
        }
    }

    pub fn is_running(&self) -> bool {
        !self.shared.exited.load(Ordering::SeqCst)
    }

    /// Sends a request and waits for the reply that names it as parent.
    /// The waiter is removed on every path so a late reply finds nothing to
    /// deliver to and is dropped.
    async fn request(&self, socket: &Mutex<zeromq::DealerSendHalf>, msg: Message, timeout: Duration) -> Result<Message> {
        let (tx, rx) = oneshot::channel();
        let id = msg.msg_id().to_string();
        self.shared.replies.lock().unwrap().insert(id.clone(), tx);
        if let Err(error) = self.send(socket, &msg).await {
            self.shared.replies.lock().unwrap().remove(&id);
            return Err(error);
        }
        let outcome = tokio::time::timeout(timeout, rx).await;
        self.shared.replies.lock().unwrap().remove(&id);
        match outcome {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err(anyhow!("R stopped before replying")),
            Err(_) => Err(anyhow!("R did not reply to {}", msg.msg_type())),
        }
    }

    /// Sockets are shared between callers, so each send takes the lock for
    /// its whole message. Frames from two messages can never interleave.
    async fn send(&self, socket: &Mutex<zeromq::DealerSendHalf>, msg: &Message) -> Result<()> {
        let frames = self.shared.signer.encode(msg);
        let message = ZmqMessage::try_from(frames).map_err(|_| anyhow!("empty message"))?;
        socket.lock().await.send(message).await?;
        Ok(())
    }
}

/// Connects one dealer socket and splits it, so replies can be read on a
/// background task while requests are sent from callers.
async fn connect_dealer(info: &ConnectionInfo, port: u16, identity: Option<&str>) -> Result<(zeromq::DealerSendHalf, zeromq::DealerRecvHalf)> {
    let mut options = SocketOptions::default();
    if let Some(identity) = identity {
        options.peer_identity(PeerIdentity::try_from(identity.as_bytes().to_vec())?);
    }
    let mut socket = DealerSocket::with_options(options);
    socket.connect(&info.endpoint(port)).await?;
    Ok(socket.split())
}

/// Waits for ark to exit, or ends it when asked to. Whichever happens
/// first, everything waiting on R is released and the interface is told.
fn spawn_exit_watcher(mut child: tokio::process::Child, kill: oneshot::Receiver<()>, shared: Arc<Shared>, log_path: PathBuf) {
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|status| status.code()),
            _ = kill => {
                let _ = child.kill().await;
                None
            }
        };
        shared.exited.store(true, Ordering::SeqCst);
        // Anyone still waiting on R would otherwise wait forever.
        for (_, run) in shared.runs.lock().unwrap().drain() {
            if let Some(waiter) = run.waiter {
                let _ = waiter.send(Err(anyhow!("R stopped")));
            }
        }
        shared.replies.lock().unwrap().clear();
        shared.visible_active.store(0, Ordering::SeqCst);
        let _ = shared.events.send(Event::Busy { busy: false });
        let _ = shared.events.send(Event::Exited { code, log: log_tail(&log_path) });
    });
}

/// Reads the output channel. Any message at all proves the subscription is
/// live, which `wait_until_ready` relies on.
fn spawn_iopub_reader(mut socket: SubSocket, shared: Arc<Shared>) {
    tokio::spawn(async move {
        while let Ok(frames) = socket.recv().await {
            let Ok(msg) = shared.signer.decode(&frames.into_vec()) else { continue };
            shared.iopub_live.store(true, Ordering::SeqCst);
            handle_iopub(&shared, msg);
        }
    });
}

/// Routes one output message to the run that caused it. Visible runs become
/// events. Helper runs collect their printed text for the caller.
fn handle_iopub(shared: &Arc<Shared>, msg: Message) {
    let Some(run_id) = msg.parent_id().map(str::to_string) else { return };
    let mut runs = shared.runs.lock().unwrap();
    // Output for requests we did not make, such as kernel_info, is ignored.
    let Some(run) = runs.get_mut(&run_id) else { return };
    let content = &msg.content;
    match msg.msg_type() {
        "status" => match content["execution_state"].as_str() {
            Some("busy") if run.visible => {
                if shared.visible_active.fetch_add(1, Ordering::SeqCst) == 0 {
                    let _ = shared.events.send(Event::Busy { busy: true });
                }
            }
            Some("idle") => {
                run.idle = true;
                finish_if_complete(shared, &mut runs, &run_id);
            }
            _ => {}
        },
        "stream" => {
            let text = content["text"].as_str().unwrap_or_default().to_string();
            if run.visible {
                let name = content["name"].as_str().unwrap_or("stdout").to_string();
                let _ = shared.events.send(Event::Stream { run: run_id, name, text });
            } else if content["name"] == "stdout" {
                run.stdout.push_str(&text);
            }
        }
        // A plot that grows, as when abline() or lines() adds to it, arrives
        // as update_display_data with the id of the plot it belongs to.
        // Dropping it would make such lines appear to do nothing.
        "execute_result" | "display_data" | "update_display_data" => {
            if run.visible {
                let data = &content["data"];
                let field = |mime: &str| data[mime].as_str().map(str::to_string);
                let _ = shared.events.send(Event::Output {
                    run: run_id,
                    text: field("text/plain"),
                    html: field("text/html"),
                    png: field("image/png"),
                    svg: field("image/svg+xml"),
                    display_id: content["transient"]["display_id"].as_str().map(str::to_string),
                    update: msg.msg_type() == "update_display_data",
                });
            } else if let Some(text) = content["data"]["text/plain"].as_str() {
                run.stdout.push_str(text);
            }
        }
        "error" => {
            let message = content["evalue"].as_str().unwrap_or("Error").to_string();
            let traceback = content["traceback"]
                .as_array()
                .map(|lines| lines.iter().filter_map(|line| line.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            if run.visible {
                let _ = shared.events.send(Event::Error { run: run_id, message, traceback });
            } else {
                run.error = Some(message);
            }
        }
        _ => {}
    }
}

/// A run is over only when both its idle status and its reply have arrived,
/// because ark may send them in either order.
fn finish_if_complete(shared: &Arc<Shared>, runs: &mut HashMap<String, Run>, run_id: &str) {
    let ready = runs.get(run_id).is_some_and(|run| run.idle && run.ok.is_some());
    if !ready {
        return;
    }
    let Some(run) = runs.remove(run_id) else { return };
    let ok = run.ok.unwrap_or(false) && run.error.is_none() && !run.stopped;
    if run.visible {
        if shared.visible_active.fetch_sub(1, Ordering::SeqCst) == 1 {
            let _ = shared.events.send(Event::Busy { busy: false });
        }
        let _ = shared.events.send(Event::Done { run: run_id.to_string(), ok, stopped: run.stopped });
    } else if let Some(waiter) = run.waiter {
        let result = match run.error {
            Some(error) => Err(anyhow!(error)),
            None => Ok(run.stdout),
        };
        let _ = waiter.send(result);
    }
}

/// Reads replies on the shell or control channel. A reply someone is
/// waiting for goes to them. An execute reply completes its run.
fn spawn_reply_reader(mut socket: zeromq::DealerRecvHalf, shared: Arc<Shared>) {
    tokio::spawn(async move {
        while let Ok(frames) = socket.recv().await {
            let Ok(msg) = shared.signer.decode(&frames.into_vec()) else { continue };
            let Some(parent) = msg.parent_id().map(str::to_string) else { continue };
            if let Some(waiter) = shared.replies.lock().unwrap().remove(&parent) {
                let _ = waiter.send(msg);
                continue;
            }
            if msg.msg_type() == "execute_reply" {
                let mut runs = shared.runs.lock().unwrap();
                if let Some(run) = runs.get_mut(&parent) {
                    run.ok = Some(msg.content["status"] == "ok");
                    finish_if_complete(&shared, &mut runs, &parent);
                }
            }
        }
    });
}

/// Reads the stdin channel, where R asks for typed input. The request is
/// kept so the answer can name it as parent, which ark requires.
fn spawn_stdin_reader(mut socket: zeromq::DealerRecvHalf, shared: Arc<Shared>) {
    tokio::spawn(async move {
        while let Ok(frames) = socket.recv().await {
            let Ok(msg) = shared.signer.decode(&frames.into_vec()) else { continue };
            if msg.msg_type() != "input_request" {
                continue;
            }
            let run = msg.parent_id().unwrap_or_default().to_string();
            let prompt = msg.content["prompt"].as_str().unwrap_or_default().to_string();
            let password = msg.content["password"].as_bool().unwrap_or(false);
            *shared.pending_input.lock().unwrap() = Some(msg);
            let _ = shared.events.send(Event::InputRequest { run, prompt, password });
        }
    });
}

/// The last lines of ark's log, which usually say why R stopped.
pub fn log_tail(path: &std::path::Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(20)..].join("\n")
}

/// Reads the JSON a helper printed, ignoring anything R printed before it.
pub fn parse_helper_json(text: &str) -> Result<Value> {
    let line = text.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("null");
    Ok(serde_json::from_str(line.trim())?)
}
