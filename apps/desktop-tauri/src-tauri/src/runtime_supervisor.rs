use std::{
    env,
    ffi::OsString,
    fmt, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
#[cfg(windows)]
use process_wrap::tokio::{CreationFlags, JobObject};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_shell::ShellExt;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{ChildStdin, ChildStdout, Command},
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
    time,
};
#[cfg(windows)]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

use crate::runtime_control::{
    ControlNdjsonDecoder, RuntimeHostControlInputFrame, RuntimeHostControlOutputFrame,
    RuntimeHostShutdownFrame, RuntimeHostShutdownReason, RuntimeHostStartFrame,
    encode_runtime_host_control_input_frame, parse_runtime_host_control_output_frame,
};
#[cfg(unix)]
use crate::unix_watchdog::{UnixWatchdog, WatchdogSpawnError};

const MAIN_WINDOW_LABEL: &str = "main";
const RUNTIME_SIDECAR_NAME: &str = "workbench-runtime-node";
const RUNTIME_RESOURCE_DIRECTORY: &str = "runtime";
const RUNTIME_ENTRYPOINT: &str = "server.mjs";
const DEFAULT_READY_TIMEOUT: Duration = Duration::from_secs(120);
const DEFAULT_HOST_SHUTDOWN_DEADLINE: Duration = Duration::from_secs(4);
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_FORCE_TIMEOUT: Duration = Duration::from_secs(5);
const RUNNING_PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(200);
const LIFECYCLE_RUNNING: u8 = 0;
const LIFECYCLE_SHUTTING_DOWN: u8 = 1;
const LIFECYCLE_ALLOW_EXIT: u8 = 2;

pub const fn bundled_renderer_origin() -> &'static str {
    if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnectionDescriptor {
    kind: &'static str,
    protocol_version: u64,
    http_origin: String,
    instance_id: String,
    access_token: String,
}

impl fmt::Debug for RuntimeConnectionDescriptor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RuntimeConnectionDescriptor")
            .field("kind", &self.kind)
            .field("protocol_version", &self.protocol_version)
            .field("http_origin", &self.http_origin)
            .field("instance_id", &self.instance_id)
            .field("access_token", &"[REDACTED]")
            .finish()
    }
}

impl RuntimeConnectionDescriptor {
    fn from_ready(
        ready: crate::runtime_control::RuntimeHostReadyFrame,
        access_token: &str,
    ) -> Self {
        Self {
            kind: "desktop-sidecar",
            protocol_version: crate::runtime_control::RUNTIME_HOST_PROTOCOL_VERSION,
            http_origin: ready.http_origin,
            instance_id: ready.instance_id,
            access_token: access_token.to_owned(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RuntimeSupervisorError {
    #[error("runtime-bootstrap-origin-rejected")]
    OriginRejected,
    #[error("runtime-bootstrap-unavailable")]
    Unavailable,
    #[error("runtime-sidecar-spawn-failed")]
    SpawnFailed,
    #[error("runtime-sidecar-control-failed")]
    ControlFailed,
    #[error("runtime-sidecar-startup-timed-out")]
    StartupTimedOut,
    #[error("runtime-sidecar-startup-rejected")]
    StartupRejected,
    #[error("runtime-sidecar-protocol-failed")]
    ProtocolFailed,
    #[error("runtime-sidecar-shutdown-failed")]
    ShutdownFailed,
}

#[derive(Debug)]
enum ControlEvent {
    Frame(RuntimeHostControlOutputFrame),
    End,
    Failed,
}

#[derive(Debug)]
struct SecretRedactor {
    secret: Vec<u8>,
    pending: Vec<u8>,
}

impl SecretRedactor {
    fn new(secret: &str) -> Self {
        Self {
            secret: secret.as_bytes().to_vec(),
            pending: Vec::new(),
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        self.pending.extend_from_slice(chunk);
        let safe_start_limit = self
            .pending
            .len()
            .saturating_sub(self.secret.len().saturating_sub(1));
        self.take_prefix(safe_start_limit)
    }

    fn finish(&mut self) -> Vec<u8> {
        let length = self.pending.len();
        self.take_prefix(length)
    }

    fn take_prefix(&mut self, safe_start_limit: usize) -> Vec<u8> {
        let mut output = Vec::new();
        let mut consumed = 0;
        while consumed < safe_start_limit {
            if !self.secret.is_empty() && self.pending[consumed..].starts_with(&self.secret) {
                output.extend_from_slice(b"[REDACTED]");
                consumed += self.secret.len();
            } else {
                output.push(self.pending[consumed]);
                consumed += 1;
            }
        }
        self.pending.drain(..consumed);
        output
    }
}

async fn read_control_stdout(mut stdout: ChildStdout, sender: mpsc::Sender<ControlEvent>) {
    let mut decoder = ControlNdjsonDecoder::default();
    let mut chunk = [0_u8; 8_192];
    loop {
        let count = match stdout.read(&mut chunk).await {
            Ok(count) => count,
            Err(_) => {
                let _ = sender.send(ControlEvent::Failed).await;
                return;
            }
        };
        if count == 0 {
            if decoder.finish().is_err() {
                let _ = sender.send(ControlEvent::Failed).await;
            } else {
                let _ = sender.send(ControlEvent::End).await;
            }
            return;
        }
        let records = match decoder.push(&chunk[..count]) {
            Ok(records) => records,
            Err(_) => {
                let _ = sender.send(ControlEvent::Failed).await;
                return;
            }
        };
        for record in records {
            let frame = match parse_runtime_host_control_output_frame(&record) {
                Ok(frame) => frame,
                Err(_) => {
                    let _ = sender.send(ControlEvent::Failed).await;
                    return;
                }
            };
            if sender.send(ControlEvent::Frame(frame)).await.is_err() {
                return;
            }
        }
    }
}

async fn forward_redacted_stderr<R: AsyncRead + Unpin>(mut stderr: R, access_token: String) {
    let mut redactor = SecretRedactor::new(&access_token);
    let mut chunk = [0_u8; 8_192];
    loop {
        match stderr.read(&mut chunk).await {
            Ok(0) => {
                write_diagnostic(&redactor.finish());
                return;
            }
            Ok(count) => write_diagnostic(&redactor.push(&chunk[..count])),
            Err(_) => {
                write_diagnostic(&redactor.finish());
                write_diagnostic(b"Runtime Host stderr stream failed.\n");
                return;
            }
        }
    }
}

fn write_diagnostic(bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let _ = io::stderr().lock().write_all(bytes);
}

fn cancellation_is_requested(signal: &Option<watch::Receiver<bool>>) -> bool {
    signal.as_ref().is_some_and(|receiver| *receiver.borrow())
}

async fn wait_for_cancellation(signal: &mut Option<watch::Receiver<bool>>) {
    let Some(receiver) = signal else {
        std::future::pending::<()>().await;
        return;
    };
    loop {
        let requested = *receiver.borrow();
        if requested || receiver.changed().await.is_err() {
            return;
        }
    }
}

fn remaining_before(deadline: time::Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(time::Instant::now())
        .filter(|remaining| !remaining.is_zero())
}

#[cfg(unix)]
fn wrap_runtime_command(
    mut command: StdCommand,
    watchdog: &UnixWatchdog,
) -> Result<Box<dyn ChildWrapper>, RuntimeSupervisorError> {
    watchdog
        .configure_runtime_command(&mut command)
        .map_err(|_| RuntimeSupervisorError::SpawnFailed)?;
    let command = Command::from(command);
    let mut wrapped = CommandWrap::from(command);
    wrapped.wrap(KillOnDrop);
    wrapped
        .spawn()
        .map_err(|_| RuntimeSupervisorError::SpawnFailed)
}

#[cfg(windows)]
fn wrap_runtime_command(
    command: StdCommand,
) -> Result<Box<dyn ChildWrapper>, RuntimeSupervisorError> {
    let command = Command::from(command);
    let mut wrapped = CommandWrap::from(command);
    wrapped.wrap(KillOnDrop);
    // JobObject temporarily rewrites creation flags while assigning the suspended child. Keep
    // the shell plugin's hidden-window contract explicit through process-wrap's composition.
    wrapped.wrap(CreationFlags(CREATE_NO_WINDOW));
    wrapped.wrap(JobObject);
    wrapped
        .spawn()
        .map_err(|_| RuntimeSupervisorError::SpawnFailed)
}

#[cfg(windows)]
async fn cleanup_spawned_child(
    child: &mut Box<dyn ChildWrapper>,
    original_error: RuntimeSupervisorError,
) -> RuntimeSupervisorError {
    if matches!(
        time::timeout(DEFAULT_FORCE_TIMEOUT, Box::into_pin(child.kill()),).await,
        Ok(Ok(()))
    ) {
        original_error
    } else {
        RuntimeSupervisorError::ShutdownFailed
    }
}

#[cfg(unix)]
async fn cleanup_spawned_child(
    child: &mut Box<dyn ChildWrapper>,
    watchdog: &mut UnixWatchdog,
    original_error: RuntimeSupervisorError,
) -> RuntimeSupervisorError {
    let deadline = time::Instant::now() + DEFAULT_FORCE_TIMEOUT;
    let watchdog_result = watchdog.terminate(deadline).await;
    let child_result = match remaining_before(deadline) {
        Some(remaining) => matches!(time::timeout(remaining, child.wait()).await, Ok(Ok(_))),
        None => false,
    };
    let empty_result = watchdog.verify_empty(deadline).await;
    if watchdog_result.is_ok() && child_result && empty_result.is_ok() {
        original_error
    } else {
        RuntimeSupervisorError::ShutdownFailed
    }
}

#[cfg(unix)]
async fn cleanup_spawned_watchdog(
    watchdog: &mut UnixWatchdog,
    original_error: RuntimeSupervisorError,
) -> RuntimeSupervisorError {
    let deadline = time::Instant::now() + DEFAULT_FORCE_TIMEOUT;
    if watchdog.terminate(deadline).await.is_ok() && watchdog.verify_empty(deadline).await.is_ok() {
        original_error
    } else {
        RuntimeSupervisorError::ShutdownFailed
    }
}

struct RuntimeSession {
    renderer_origin: String,
    connection: RuntimeConnectionDescriptor,
    child: Box<dyn ChildWrapper>,
    #[cfg(unix)]
    watchdog: UnixWatchdog,
    stdin: Option<ChildStdin>,
    control_events: mpsc::Receiver<ControlEvent>,
    stdout_task: Option<JoinHandle<()>>,
    stderr_task: Option<JoinHandle<()>>,
}

impl RuntimeSession {
    async fn start(
        command: StdCommand,
        renderer_origin: String,
        access_token: String,
        ready_timeout: Duration,
        mut shutdown_signal: Option<watch::Receiver<bool>>,
    ) -> Result<Self, RuntimeSupervisorError> {
        let start = RuntimeHostControlInputFrame::Start(
            RuntimeHostStartFrame::new(access_token.clone(), [renderer_origin.clone()])
                .map_err(|_| RuntimeSupervisorError::ControlFailed)?,
        );
        if cancellation_is_requested(&shutdown_signal) {
            return Err(RuntimeSupervisorError::Unavailable);
        }
        let startup_deadline = time::Instant::now() + ready_timeout;
        #[cfg(unix)]
        let mut watchdog = UnixWatchdog::spawn(startup_deadline, &mut shutdown_signal)
            .await
            .map_err(|error| match error {
                WatchdogSpawnError::Failed => RuntimeSupervisorError::SpawnFailed,
                WatchdogSpawnError::Cancelled => RuntimeSupervisorError::Unavailable,
                WatchdogSpawnError::CleanupFailed => RuntimeSupervisorError::ShutdownFailed,
            })?;
        #[cfg(unix)]
        if cancellation_is_requested(&shutdown_signal) {
            return Err(cleanup_spawned_watchdog(
                &mut watchdog,
                RuntimeSupervisorError::Unavailable,
            )
            .await);
        }
        #[cfg(unix)]
        let mut child = match wrap_runtime_command(command, &watchdog) {
            Ok(child) => child,
            Err(error) => return Err(cleanup_spawned_watchdog(&mut watchdog, error).await),
        };
        #[cfg(windows)]
        let mut child = wrap_runtime_command(command)?;
        let Some(child_pid) = child.id() else {
            #[cfg(unix)]
            let error = cleanup_spawned_child(
                &mut child,
                &mut watchdog,
                RuntimeSupervisorError::SpawnFailed,
            )
            .await;
            #[cfg(windows)]
            let error =
                cleanup_spawned_child(&mut child, RuntimeSupervisorError::SpawnFailed).await;
            return Err(error);
        };
        let Some(stdin) = child.stdin().take() else {
            #[cfg(unix)]
            let error = cleanup_spawned_child(
                &mut child,
                &mut watchdog,
                RuntimeSupervisorError::SpawnFailed,
            )
            .await;
            #[cfg(windows)]
            let error =
                cleanup_spawned_child(&mut child, RuntimeSupervisorError::SpawnFailed).await;
            return Err(error);
        };
        let Some(stdout) = child.stdout().take() else {
            #[cfg(unix)]
            let error = cleanup_spawned_child(
                &mut child,
                &mut watchdog,
                RuntimeSupervisorError::SpawnFailed,
            )
            .await;
            #[cfg(windows)]
            let error =
                cleanup_spawned_child(&mut child, RuntimeSupervisorError::SpawnFailed).await;
            return Err(error);
        };
        let Some(stderr) = child.stderr().take() else {
            #[cfg(unix)]
            let error = cleanup_spawned_child(
                &mut child,
                &mut watchdog,
                RuntimeSupervisorError::SpawnFailed,
            )
            .await;
            #[cfg(windows)]
            let error =
                cleanup_spawned_child(&mut child, RuntimeSupervisorError::SpawnFailed).await;
            return Err(error);
        };
        let (control_sender, control_events) = mpsc::channel(8);
        let stdout_task = tokio::spawn(read_control_stdout(stdout, control_sender));
        let stderr_task = tokio::spawn(forward_redacted_stderr(stderr, access_token.clone()));
        let mut session = Self {
            renderer_origin: renderer_origin.clone(),
            connection: RuntimeConnectionDescriptor {
                kind: "desktop-sidecar",
                protocol_version: crate::runtime_control::RUNTIME_HOST_PROTOCOL_VERSION,
                http_origin: String::new(),
                instance_id: String::new(),
                access_token: access_token.clone(),
            },
            child,
            #[cfg(unix)]
            watchdog,
            stdin: Some(stdin),
            control_events,
            stdout_task: Some(stdout_task),
            stderr_task: Some(stderr_task),
        };

        let Some(write_timeout) = remaining_before(startup_deadline) else {
            return Err(session
                .cleanup_after_error(RuntimeSupervisorError::StartupTimedOut)
                .await);
        };
        let write_result = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut shutdown_signal) => {
                Err(RuntimeSupervisorError::Unavailable)
            }
            result = session.write_frame(&start, write_timeout) => result,
        };
        if let Err(error) = write_result {
            return Err(session.cleanup_after_error(error).await);
        }
        let Some(ready_timeout) = remaining_before(startup_deadline) else {
            return Err(session
                .cleanup_after_error(RuntimeSupervisorError::StartupTimedOut)
                .await);
        };
        #[cfg(unix)]
        let event = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut shutdown_signal) => {
                Err(RuntimeSupervisorError::Unavailable)
            }
            _ = session.watchdog.wait_for_failure() => {
                Err(RuntimeSupervisorError::ProtocolFailed)
            }
            result = time::timeout(ready_timeout, session.control_events.recv()) => {
                match result {
                    Ok(Some(event)) => Ok(event),
                    Ok(None) => Err(RuntimeSupervisorError::ControlFailed),
                    Err(_) => Err(RuntimeSupervisorError::StartupTimedOut),
                }
            }
        };
        #[cfg(windows)]
        let event = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut shutdown_signal) => {
                Err(RuntimeSupervisorError::Unavailable)
            }
            result = time::timeout(ready_timeout, session.control_events.recv()) => {
                match result {
                    Ok(Some(event)) => Ok(event),
                    Ok(None) => Err(RuntimeSupervisorError::ControlFailed),
                    Err(_) => Err(RuntimeSupervisorError::StartupTimedOut),
                }
            }
        };
        let event = match event {
            Ok(event) => event,
            Err(error) => return Err(session.cleanup_after_error(error).await),
        };
        match event {
            ControlEvent::Frame(RuntimeHostControlOutputFrame::Ready(ready))
                if ready.pid == u64::from(child_pid) && ready.instance_id != access_token =>
            {
                session.connection = RuntimeConnectionDescriptor::from_ready(ready, &access_token);
            }
            ControlEvent::Frame(RuntimeHostControlOutputFrame::StartupError(_)) => {
                return Err(session
                    .cleanup_after_error(RuntimeSupervisorError::StartupRejected)
                    .await);
            }
            _ => {
                return Err(session
                    .cleanup_after_error(RuntimeSupervisorError::ProtocolFailed)
                    .await);
            }
        }
        if session.assert_running_and_drained().is_err() {
            return Err(session
                .cleanup_after_error(RuntimeSupervisorError::ProtocolFailed)
                .await);
        }
        if cancellation_is_requested(&shutdown_signal) {
            return Err(session
                .cleanup_after_error(RuntimeSupervisorError::Unavailable)
                .await);
        }
        Ok(session)
    }

    async fn write_frame(
        &mut self,
        frame: &RuntimeHostControlInputFrame,
        timeout: Duration,
    ) -> Result<(), RuntimeSupervisorError> {
        let encoded = encode_runtime_host_control_input_frame(frame)
            .map_err(|_| RuntimeSupervisorError::ControlFailed)?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or(RuntimeSupervisorError::ControlFailed)?;
        time::timeout(timeout, async {
            stdin.write_all(&encoded).await?;
            stdin.flush().await
        })
        .await
        .map_err(|_| RuntimeSupervisorError::ControlFailed)?
        .map_err(|_| RuntimeSupervisorError::ControlFailed)
    }

    fn assert_running_and_drained(&mut self) -> Result<(), RuntimeSupervisorError> {
        #[cfg(unix)]
        self.watchdog
            .assert_healthy()
            .map_err(|_| RuntimeSupervisorError::ProtocolFailed)?;
        if self
            .child
            .try_wait()
            .map_err(|_| RuntimeSupervisorError::ControlFailed)?
            .is_some()
        {
            return Err(RuntimeSupervisorError::ProtocolFailed);
        }
        match self.control_events.try_recv() {
            Err(mpsc::error::TryRecvError::Empty) => Ok(()),
            _ => Err(RuntimeSupervisorError::ProtocolFailed),
        }
    }

    async fn shutdown(
        mut self,
        reason: RuntimeHostShutdownReason,
        host_shutdown_deadline: Duration,
        graceful_timeout: Duration,
        force_timeout: Duration,
    ) -> Result<(), RuntimeSupervisorError> {
        let graceful_deadline = time::Instant::now() + graceful_timeout;
        if self.assert_running_and_drained().is_err() {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        let deadline_ms = u64::try_from(host_shutdown_deadline.as_millis())
            .ok()
            .filter(|value| (1..=60_000).contains(value))
            .unwrap_or_default();
        let Ok(shutdown) = RuntimeHostShutdownFrame::new(reason, deadline_ms) else {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        };
        let shutdown = RuntimeHostControlInputFrame::Shutdown(shutdown);
        let Some(write_timeout) = remaining_before(graceful_deadline) else {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        };
        if self.write_frame(&shutdown, write_timeout).await.is_err() {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        let Some(acknowledgement_timeout) = remaining_before(graceful_deadline) else {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        };
        let acknowledgement =
            time::timeout(acknowledgement_timeout, self.control_events.recv()).await;
        if !matches!(
            acknowledgement,
            Ok(Some(ControlEvent::Frame(
                RuntimeHostControlOutputFrame::ShutdownAck
            )))
        ) {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        if let Some(mut stdin) = self.stdin.take() {
            let Some(stdin_timeout) = remaining_before(graceful_deadline) else {
                self.force_cleanup(force_timeout).await?;
                return Err(RuntimeSupervisorError::ShutdownFailed);
            };
            if !matches!(
                time::timeout(stdin_timeout, stdin.shutdown()).await,
                Ok(Ok(()))
            ) {
                self.force_cleanup(force_timeout).await?;
                return Err(RuntimeSupervisorError::ShutdownFailed);
            }
        }
        let Some(exit_timeout) = remaining_before(graceful_deadline) else {
            self.force_cleanup(force_timeout).await?;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        };
        match time::timeout(exit_timeout, self.child.wait()).await {
            Ok(Ok(status)) if status.success() => {}
            _ => {
                self.force_cleanup(force_timeout).await?;
                return Err(RuntimeSupervisorError::ShutdownFailed);
            }
        }
        #[cfg(unix)]
        if self.watchdog.terminate(graceful_deadline).await.is_err() {
            let _ = self.force_cleanup(force_timeout).await;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        #[cfg(unix)]
        if self.watchdog.verify_empty(graceful_deadline).await.is_err() {
            let _ = self.force_cleanup(force_timeout).await;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        if self
            .join_output_tasks_until(graceful_deadline)
            .await
            .is_err()
        {
            let _ = self.force_cleanup(force_timeout).await;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        let mut saw_end = false;
        let mut invalid_terminal_event = false;
        loop {
            match self.control_events.try_recv() {
                Ok(ControlEvent::End) if !saw_end => saw_end = true,
                Err(mpsc::error::TryRecvError::Empty | mpsc::error::TryRecvError::Disconnected) => {
                    break;
                }
                _ => {
                    invalid_terminal_event = true;
                    break;
                }
            }
        }
        if !saw_end || invalid_terminal_event {
            let _ = self.force_cleanup(force_timeout).await;
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        Ok(())
    }

    async fn cleanup_after_error(
        &mut self,
        original_error: RuntimeSupervisorError,
    ) -> RuntimeSupervisorError {
        if self.force_cleanup(DEFAULT_FORCE_TIMEOUT).await.is_ok() {
            original_error
        } else {
            RuntimeSupervisorError::ShutdownFailed
        }
    }

    async fn force_cleanup(&mut self, timeout: Duration) -> Result<(), RuntimeSupervisorError> {
        let deadline = time::Instant::now() + timeout;
        self.stdin.take();
        #[cfg(unix)]
        let containment_succeeded = self.watchdog.terminate(deadline).await.is_ok();
        #[cfg(unix)]
        let kill_succeeded = match remaining_before(deadline) {
            Some(remaining) => {
                matches!(time::timeout(remaining, self.child.wait()).await, Ok(Ok(_)))
            }
            None => false,
        };
        #[cfg(unix)]
        let group_is_empty = self.watchdog.verify_empty(deadline).await.is_ok();
        #[cfg(windows)]
        let kill_succeeded = match remaining_before(deadline) {
            Some(remaining) => matches!(
                time::timeout(remaining, Box::into_pin(self.child.kill())).await,
                Ok(Ok(()))
            ),
            None => false,
        };
        let tasks_result = self.join_output_tasks_until(deadline).await;
        #[cfg(unix)]
        let cleanup_succeeded = containment_succeeded && kill_succeeded && group_is_empty;
        #[cfg(windows)]
        let cleanup_succeeded = kill_succeeded;
        if !cleanup_succeeded || tasks_result.is_err() {
            return Err(RuntimeSupervisorError::ShutdownFailed);
        }
        Ok(())
    }

    async fn join_output_tasks_until(
        &mut self,
        deadline: time::Instant,
    ) -> Result<(), RuntimeSupervisorError> {
        let mut failed = false;
        for task in [&mut self.stdout_task, &mut self.stderr_task] {
            let Some(mut task) = task.take() else {
                continue;
            };
            let Some(remaining) = remaining_before(deadline) else {
                task.abort();
                let _ = task.await;
                failed = true;
                break;
            };
            if !matches!(time::timeout(remaining, &mut task).await, Ok(Ok(()))) {
                task.abort();
                let _ = task.await;
                failed = true;
                break;
            }
        }
        if failed {
            self.abort_output_tasks().await;
            Err(RuntimeSupervisorError::ShutdownFailed)
        } else {
            Ok(())
        }
    }

    async fn abort_output_tasks(&mut self) {
        for task in [&mut self.stdout_task, &mut self.stderr_task] {
            if let Some(task) = task.take() {
                task.abort();
                let _ = task.await;
            }
        }
    }
}

enum SupervisorRequest {
    Bootstrap {
        renderer_origin: String,
        response: oneshot::Sender<Result<RuntimeConnectionDescriptor, RuntimeSupervisorError>>,
    },
    Restart {
        renderer_origin: String,
        response: oneshot::Sender<Result<(), RuntimeSupervisorError>>,
    },
    Shutdown {
        reason: RuntimeHostShutdownReason,
        response: oneshot::Sender<Result<(), RuntimeSupervisorError>>,
    },
}

pub struct RuntimeSupervisor {
    requests: mpsc::Sender<SupervisorRequest>,
    lifecycle: Arc<AtomicU8>,
    lifecycle_gate: Arc<Mutex<()>>,
    shutdown_signal: watch::Sender<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitDisposition {
    StartShutdown,
    WaitForShutdown,
    AllowExit,
}

impl RuntimeSupervisor {
    pub fn new<R: Runtime>(app: AppHandle<R>) -> Self {
        let (requests, receiver) = mpsc::channel(8);
        let lifecycle = Arc::new(AtomicU8::new(LIFECYCLE_RUNNING));
        let lifecycle_gate = Arc::new(Mutex::new(()));
        let (shutdown_signal, shutdown_receiver) = watch::channel(false);
        tauri::async_runtime::spawn(run_supervisor(
            app,
            receiver,
            lifecycle.clone(),
            lifecycle_gate.clone(),
            shutdown_receiver,
        ));
        Self {
            requests,
            lifecycle,
            lifecycle_gate,
            shutdown_signal,
        }
    }

    pub async fn bootstrap(
        &self,
        renderer_origin: String,
    ) -> Result<RuntimeConnectionDescriptor, RuntimeSupervisorError> {
        if self.lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
            return Err(RuntimeSupervisorError::Unavailable);
        }
        let (response, result) = oneshot::channel();
        self.requests
            .send(SupervisorRequest::Bootstrap {
                renderer_origin,
                response,
            })
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?;
        result
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?
    }

    pub async fn shutdown(
        &self,
        reason: RuntimeHostShutdownReason,
    ) -> Result<(), RuntimeSupervisorError> {
        let (response, result) = oneshot::channel();
        self.requests
            .send(SupervisorRequest::Shutdown { reason, response })
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?;
        result
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?
    }

    pub async fn restart(&self, renderer_origin: String) -> Result<(), RuntimeSupervisorError> {
        if self.lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
            return Err(RuntimeSupervisorError::Unavailable);
        }
        let (response, result) = oneshot::channel();
        self.requests
            .send(SupervisorRequest::Restart {
                renderer_origin,
                response,
            })
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?;
        result
            .await
            .map_err(|_| RuntimeSupervisorError::Unavailable)?
    }

    pub fn exit_disposition(&self) -> ExitDisposition {
        let _gate = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match self.lifecycle.compare_exchange(
            LIFECYCLE_RUNNING,
            LIFECYCLE_SHUTTING_DOWN,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => {
                self.shutdown_signal.send_replace(true);
                ExitDisposition::StartShutdown
            }
            Err(LIFECYCLE_SHUTTING_DOWN) => ExitDisposition::WaitForShutdown,
            Err(LIFECYCLE_ALLOW_EXIT) => ExitDisposition::AllowExit,
            Err(_) => ExitDisposition::WaitForShutdown,
        }
    }

    pub fn allow_exit(&self) {
        let _gate = self
            .lifecycle_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.lifecycle.store(LIFECYCLE_ALLOW_EXIT, Ordering::SeqCst);
    }
}

async fn run_supervisor<R: Runtime>(
    app: AppHandle<R>,
    mut requests: mpsc::Receiver<SupervisorRequest>,
    lifecycle: Arc<AtomicU8>,
    lifecycle_gate: Arc<Mutex<()>>,
    shutdown_signal: watch::Receiver<bool>,
) {
    let mut session: Option<RuntimeSession> = None;
    let mut runtime_failed = false;
    loop {
        if session.is_none() {
            let Some(request) = requests.recv().await else {
                return;
            };
            handle_request(
                &app,
                request,
                &mut session,
                &lifecycle,
                &lifecycle_gate,
                &shutdown_signal,
                &mut runtime_failed,
            )
            .await;
            continue;
        }

        enum RunningEvent {
            Request(Option<SupervisorRequest>),
            Control,
            #[cfg(unix)]
            Containment,
            Poll,
        }
        #[cfg(unix)]
        let event = {
            let active = session.as_mut().expect("session checked above");
            tokio::select! {
                request = requests.recv() => RunningEvent::Request(request),
                _ = active.control_events.recv() => RunningEvent::Control,
                _ = active.watchdog.wait_for_failure() => RunningEvent::Containment,
                _ = time::sleep(RUNNING_PROCESS_POLL_INTERVAL) => RunningEvent::Poll,
            }
        };
        #[cfg(windows)]
        let event = {
            let active = session.as_mut().expect("session checked above");
            tokio::select! {
                request = requests.recv() => RunningEvent::Request(request),
                _ = active.control_events.recv() => RunningEvent::Control,
                _ = time::sleep(RUNNING_PROCESS_POLL_INTERVAL) => RunningEvent::Poll,
            }
        };
        match event {
            RunningEvent::Request(Some(request)) => {
                handle_request(
                    &app,
                    request,
                    &mut session,
                    &lifecycle,
                    &lifecycle_gate,
                    &shutdown_signal,
                    &mut runtime_failed,
                )
                .await;
            }
            RunningEvent::Request(None) => {
                if let Some(active) = session.take()
                    && active
                        .shutdown(
                            RuntimeHostShutdownReason::ContainerExit,
                            DEFAULT_HOST_SHUTDOWN_DEADLINE,
                            DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT,
                            DEFAULT_FORCE_TIMEOUT,
                        )
                        .await
                        .is_err()
                {
                    write_diagnostic(b"Runtime Host shutdown could not be confirmed.\n");
                }
                return;
            }
            RunningEvent::Control => {
                if let Some(mut active) = session.take()
                    && active.force_cleanup(DEFAULT_FORCE_TIMEOUT).await.is_err()
                {
                    write_diagnostic(b"Runtime Host forced cleanup could not be confirmed.\n");
                }
                runtime_failed = true;
                write_diagnostic(b"Runtime Host control channel failed after startup.\n");
            }
            #[cfg(unix)]
            RunningEvent::Containment => {
                if let Some(mut active) = session.take()
                    && active.force_cleanup(DEFAULT_FORCE_TIMEOUT).await.is_err()
                {
                    write_diagnostic(b"Runtime Host forced cleanup could not be confirmed.\n");
                }
                runtime_failed = true;
                write_diagnostic(b"Runtime Host watchdog health channel failed after startup.\n");
            }
            RunningEvent::Poll => {
                let failure: Option<&'static [u8]> = match session.as_mut() {
                    Some(active) => match active.child.try_wait() {
                        Ok(None) => None,
                        Ok(Some(_)) => Some(b"Runtime Host exited unexpectedly.\n"),
                        Err(_) => Some(b"Runtime Host process state could not be inspected.\n"),
                    },
                    None => None,
                };
                if let Some(message) = failure {
                    if let Some(mut active) = session.take()
                        && active.force_cleanup(DEFAULT_FORCE_TIMEOUT).await.is_err()
                    {
                        write_diagnostic(b"Runtime Host forced cleanup could not be confirmed.\n");
                    }
                    runtime_failed = true;
                    write_diagnostic(message);
                }
            }
        }
    }
}

fn bootstrap_active_session(
    active: &mut RuntimeSession,
    renderer_origin: &str,
) -> Result<RuntimeConnectionDescriptor, RuntimeSupervisorError> {
    if active.renderer_origin == renderer_origin && active.assert_running_and_drained().is_ok() {
        Ok(active.connection.clone())
    } else {
        Err(RuntimeSupervisorError::OriginRejected)
    }
}

fn bootstrap_is_available(lifecycle: &AtomicU8, runtime_failed: bool) -> bool {
    lifecycle.load(Ordering::SeqCst) == LIFECYCLE_RUNNING && !runtime_failed
}

async fn handle_request<R: Runtime>(
    app: &AppHandle<R>,
    request: SupervisorRequest,
    session: &mut Option<RuntimeSession>,
    lifecycle: &AtomicU8,
    lifecycle_gate: &Mutex<()>,
    shutdown_signal: &watch::Receiver<bool>,
    runtime_failed: &mut bool,
) {
    match request {
        SupervisorRequest::Bootstrap {
            renderer_origin,
            response,
        } => {
            if !bootstrap_is_available(lifecycle, *runtime_failed) {
                let _ = response.send(Err(RuntimeSupervisorError::Unavailable));
                return;
            }
            if let Some(active) = session.as_mut() {
                let _gate = lifecycle_gate
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
                    let _ = response.send(Err(RuntimeSupervisorError::Unavailable));
                    return;
                }
                let result = bootstrap_active_session(active, &renderer_origin);
                let _ = response.send(result);
                return;
            }
            let result =
                start_production_session(app, renderer_origin, shutdown_signal.clone()).await;
            match result {
                Ok(mut active) => {
                    let gate = lifecycle_gate
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
                        drop(gate);
                        let error = active
                            .cleanup_after_error(RuntimeSupervisorError::Unavailable)
                            .await;
                        *runtime_failed |= error == RuntimeSupervisorError::ShutdownFailed;
                        let _ = response.send(Err(error));
                        return;
                    }
                    let connection = active.connection.clone();
                    *session = Some(active);
                    let _ = response.send(Ok(connection));
                }
                Err(error) => {
                    *runtime_failed |= error == RuntimeSupervisorError::ShutdownFailed;
                    let _ = response.send(Err(error));
                }
            }
        }
        SupervisorRequest::Restart {
            renderer_origin,
            response,
        } => {
            if lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
                let _ = response.send(Err(RuntimeSupervisorError::Unavailable));
                return;
            }
            let Some(active) = session.as_ref() else {
                let _ = response.send(Err(RuntimeSupervisorError::Unavailable));
                return;
            };
            if active.renderer_origin != renderer_origin {
                let _ = response.send(Err(RuntimeSupervisorError::OriginRejected));
                return;
            }

            let active = session.take().expect("active session checked above");
            let replacement = restart_after_drain(
                active,
                start_production_session(app, renderer_origin, shutdown_signal.clone()),
            )
            .await;
            match replacement {
                Ok(mut active) => {
                    let gate = lifecycle_gate
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if lifecycle.load(Ordering::SeqCst) != LIFECYCLE_RUNNING {
                        drop(gate);
                        let error = active
                            .cleanup_after_error(RuntimeSupervisorError::Unavailable)
                            .await;
                        *runtime_failed |= error == RuntimeSupervisorError::ShutdownFailed;
                        let _ = response.send(Err(error));
                        return;
                    }
                    *session = Some(active);
                    let _ = response.send(Ok(()));
                }
                Err(error) => {
                    *runtime_failed |= error == RuntimeSupervisorError::ShutdownFailed;
                    let _ = response.send(Err(error));
                }
            }
        }
        SupervisorRequest::Shutdown { reason, response } => {
            let prior_failure = *runtime_failed;
            let cleanup_result = match session.take() {
                Some(active) => {
                    active
                        .shutdown(
                            reason,
                            DEFAULT_HOST_SHUTDOWN_DEADLINE,
                            DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT,
                            DEFAULT_FORCE_TIMEOUT,
                        )
                        .await
                }
                None => Ok(()),
            };
            let result = if prior_failure || cleanup_result.is_err() {
                Err(RuntimeSupervisorError::ShutdownFailed)
            } else {
                Ok(())
            };
            *runtime_failed |= result.is_err();
            let _ = response.send(result);
        }
    }
}

async fn restart_after_drain(
    active: RuntimeSession,
    replacement: impl std::future::Future<Output = Result<RuntimeSession, RuntimeSupervisorError>>,
) -> Result<RuntimeSession, RuntimeSupervisorError> {
    let old_instance_id = active.connection.instance_id.clone();
    active
        .shutdown(
            RuntimeHostShutdownReason::Restart,
            DEFAULT_HOST_SHUTDOWN_DEADLINE,
            DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT,
            DEFAULT_FORCE_TIMEOUT,
        )
        .await?;
    let mut replacement = replacement.await?;
    if replacement.connection.instance_id == old_instance_id {
        return Err(replacement
            .cleanup_after_error(RuntimeSupervisorError::ProtocolFailed)
            .await);
    }
    Ok(replacement)
}

async fn start_production_session<R: Runtime>(
    app: &AppHandle<R>,
    renderer_origin: String,
    shutdown_signal: watch::Receiver<bool>,
) -> Result<RuntimeSession, RuntimeSupervisorError> {
    let access_token = create_access_token()?;
    let command = production_runtime_command(app)?;
    RuntimeSession::start(
        command,
        renderer_origin,
        access_token,
        DEFAULT_READY_TIMEOUT,
        Some(shutdown_signal),
    )
    .await
}

fn create_access_token() -> Result<String, RuntimeSupervisorError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| RuntimeSupervisorError::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn production_runtime_command<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StdCommand, RuntimeSupervisorError> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|_| RuntimeSupervisorError::Unavailable)?;
    let runtime_root = canonical_runtime_root(&resource_directory)?;
    let entrypoint = runtime_root.join(RUNTIME_ENTRYPOINT);
    let entry_metadata =
        fs::symlink_metadata(&entrypoint).map_err(|_| RuntimeSupervisorError::Unavailable)?;
    if !entry_metadata.is_file() || entry_metadata.file_type().is_symlink() {
        return Err(RuntimeSupervisorError::Unavailable);
    }
    let entrypoint =
        fs::canonicalize(entrypoint).map_err(|_| RuntimeSupervisorError::Unavailable)?;
    if entrypoint.parent() != Some(runtime_root.as_path()) {
        return Err(RuntimeSupervisorError::Unavailable);
    }

    let environment = sanitized_runtime_environment();
    let command = app
        .shell()
        .sidecar(RUNTIME_SIDECAR_NAME)
        .map_err(|_| RuntimeSupervisorError::Unavailable)?
        .arg(entrypoint)
        .current_dir(&runtime_root)
        .env_clear()
        .envs(environment);
    let command: StdCommand = command.into();
    crate::runtime_envelope::verify_runtime_envelope(
        &runtime_root,
        Path::new(command.get_program()),
    )
    .map_err(|_| RuntimeSupervisorError::Unavailable)?;
    Ok(command)
}

fn canonical_runtime_root(resource_directory: &Path) -> Result<PathBuf, RuntimeSupervisorError> {
    let configured = resource_directory.join(RUNTIME_RESOURCE_DIRECTORY);
    let metadata =
        fs::symlink_metadata(&configured).map_err(|_| RuntimeSupervisorError::Unavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(RuntimeSupervisorError::Unavailable);
    }
    fs::canonicalize(configured).map_err(|_| RuntimeSupervisorError::Unavailable)
}

fn sanitized_runtime_environment() -> Vec<(OsString, OsString)> {
    let mut environment = env::vars_os()
        .filter(|(name, _)| {
            let normalized = name.to_string_lossy().to_uppercase();
            !normalized.starts_with("NODE_")
                && !normalized.starts_with("WORKBENCH_")
                && !matches!(
                    normalized.as_str(),
                    "ELECTRON_RUN_AS_NODE" | "HOSTNAME" | "PORT" | "PI_WORKBENCH_SETTINGS_FILE"
                )
        })
        .collect::<Vec<_>>();
    environment.extend([
        (OsString::from("NODE_ENV"), OsString::from("production")),
        (
            OsString::from("WORKBENCH_RUNTIME_MANAGED_CHILD"),
            OsString::from("1"),
        ),
    ]);
    environment
}

pub fn renderer_origin_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<String, RuntimeSupervisorError> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err(RuntimeSupervisorError::OriginRejected);
    }
    let url = window
        .url()
        .map_err(|_| RuntimeSupervisorError::OriginRejected)?;
    allowed_renderer_origin(url.as_str()).ok_or(RuntimeSupervisorError::OriginRejected)
}

fn allowed_renderer_origin(value: &str) -> Option<String> {
    let mut url = url::Url::parse(value).ok()?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    let origin = crate::runtime_control::canonical_renderer_origin(url.as_str())?;
    if matches!(
        origin.as_str(),
        "tauri://localhost" | "http://tauri.localhost"
    ) {
        return Some(origin);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{process::Stdio, sync::atomic::AtomicU64};

    const FIXTURE_ORIGIN: &str = "tauri://localhost";
    const FIXTURE_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/test-fixtures/runtime-supervisor-child.mjs"
    );
    const STARTUP_TIMEOUT: Duration = Duration::from_secs(2);
    const HOST_DEADLINE: Duration = Duration::from_millis(100);
    const GRACEFUL_TIMEOUT: Duration = Duration::from_secs(1);
    const FORCE_TIMEOUT: Duration = Duration::from_secs(1);
    static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(1);

    fn fixture_token(label: &str) -> String {
        format!(
            "fixture-access-token-{label}-{}",
            NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn available_loopback_port() -> u16 {
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .expect("reserve fixture port")
            .local_addr()
            .expect("read fixture port")
            .port()
    }

    fn scripted_command(scenario: &str, instance_id: &str, port: u16) -> StdCommand {
        let node = env::var_os("NODE_BINARY")
            .or_else(|| env::var_os("NODE"))
            .unwrap_or_else(|| OsString::from("node"));
        let mut command = StdCommand::new(node);
        command
            .arg(FIXTURE_PATH)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("RUNTIME_FIXTURE_SCENARIO", scenario)
            .env("RUNTIME_FIXTURE_INSTANCE_ID", instance_id)
            .env("RUNTIME_FIXTURE_PORT", port.to_string())
            .env("RUNTIME_FIXTURE_RENDERER_ORIGIN", FIXTURE_ORIGIN);
        command
    }

    fn expect_shutdown_frame(
        command: &mut StdCommand,
        reason: RuntimeHostShutdownReason,
        deadline: Duration,
    ) {
        let reason = match reason {
            RuntimeHostShutdownReason::Requested => "requested",
            RuntimeHostShutdownReason::ContainerExit => "container-exit",
            RuntimeHostShutdownReason::Restart => "restart",
        };
        command
            .env("RUNTIME_FIXTURE_EXPECTED_SHUTDOWN_REASON", reason)
            .env(
                "RUNTIME_FIXTURE_EXPECTED_DEADLINE_MS",
                deadline.as_millis().to_string(),
            );
    }

    async fn start_scripted(
        command: StdCommand,
        access_token: String,
        ready_timeout: Duration,
    ) -> Result<RuntimeSession, RuntimeSupervisorError> {
        RuntimeSession::start(
            command,
            FIXTURE_ORIGIN.to_owned(),
            access_token,
            ready_timeout,
            None,
        )
        .await
    }

    async fn assert_start_error(
        scenario: &str,
        expected: RuntimeSupervisorError,
        ready_timeout: Duration,
    ) {
        let id = NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
        let instance_id = format!("{scenario}-{id}");
        let token = fixture_token(scenario);
        let command = scripted_command(scenario, &instance_id, available_loopback_port());
        match start_scripted(command, token, ready_timeout).await {
            Err(actual) => assert_eq!(actual, expected, "scenario {scenario}"),
            Ok(mut session) => {
                let _ = session.force_cleanup(FORCE_TIMEOUT).await;
                panic!("scenario {scenario} unexpectedly started");
            }
        }
    }

    fn unique_marker_path(label: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "workbench-runtime-supervisor-{label}-{}-{}",
            std::process::id(),
            NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    async fn wait_for_pid_file(path: &Path) -> u32 {
        let deadline = time::Instant::now() + Duration::from_secs(2);
        loop {
            if let Ok(contents) = fs::read_to_string(path)
                && let Ok(pid) = contents.parse()
            {
                return pid;
            }
            assert!(
                time::Instant::now() < deadline,
                "fixture did not write {}",
                path.display()
            );
            time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(target_os = "linux")]
    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct EscapedDescendantIdentity {
        pid: u32,
        pgrp: u32,
        session: u32,
        starttime: String,
    }

    #[cfg(target_os = "linux")]
    async fn wait_for_nonempty_file(path: &Path, timeout: Duration) -> Result<String, String> {
        let deadline = time::Instant::now() + timeout;
        loop {
            match fs::read_to_string(path) {
                Ok(contents) if !contents.is_empty() => return Ok(contents),
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("failed to read {}: {error}", path.display()));
                }
            }
            if time::Instant::now() >= deadline {
                return Err(format!("fixture did not write {}", path.display()));
            }
            time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_process_starttime(pid: u32) -> Result<Option<String>, String> {
        let stat = match fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("failed to read /proc/{pid}/stat: {error}")),
        };
        let (_, after_name) = stat
            .rsplit_once(") ")
            .ok_or_else(|| format!("malformed /proc/{pid}/stat"))?;
        let fields = after_name.split_whitespace().collect::<Vec<_>>();
        let state = fields
            .first()
            .ok_or_else(|| format!("missing state in /proc/{pid}/stat"))?;
        if matches!(*state, "Z" | "X") {
            return Ok(None);
        }
        fields
            .get(19)
            .map(|starttime| Some((*starttime).to_owned()))
            .ok_or_else(|| format!("missing starttime in /proc/{pid}/stat"))
    }

    #[cfg(target_os = "linux")]
    async fn precisely_cleanup_escaped_descendant(
        identity: &EscapedDescendantIdentity,
        cleanup_file: &Path,
        cleanup_ack_file: &Path,
    ) -> Result<(), String> {
        let expected = format!("{}:{}", identity.pid, identity.starttime);
        match linux_process_starttime(identity.pid)? {
            Some(current) if current == identity.starttime => {}
            Some(current) => {
                return Err(format!(
                    "escaped PID {} was reused before cleanup: expected starttime {}, got {current}",
                    identity.pid, identity.starttime
                ));
            }
            None => {
                return Err(format!(
                    "escaped identity {expected} vanished before exact cleanup"
                ));
            }
        }

        let mut uncertainty = fs::write(cleanup_file, &expected)
            .err()
            .map(|error| format!("failed to request exact cleanup for {expected}: {error}"));
        let prompt_deadline = time::Instant::now() + Duration::from_secs(2);
        let watchdog_deadline = time::Instant::now() + Duration::from_secs(12);
        let mut acknowledgement = None;
        loop {
            if acknowledgement.is_none()
                && let Ok(contents) = fs::read_to_string(cleanup_ack_file)
                && !contents.is_empty()
            {
                acknowledgement = Some(contents);
            }
            match linux_process_starttime(identity.pid) {
                Ok(Some(current)) if current == identity.starttime => {}
                Ok(_) => break,
                Err(error) => {
                    uncertainty.get_or_insert(error);
                }
            }
            let now = time::Instant::now();
            if now >= prompt_deadline {
                uncertainty.get_or_insert_with(|| {
                    format!("escaped identity {expected} did not stop promptly")
                });
            }
            if now >= watchdog_deadline {
                return Err(format!(
                    "escaped identity {expected} could not be confirmed stopped"
                ));
            }
            time::sleep(Duration::from_millis(10)).await;
        }

        if acknowledgement.is_none()
            && let Ok(contents) = fs::read_to_string(cleanup_ack_file)
            && !contents.is_empty()
        {
            acknowledgement = Some(contents);
        }
        if acknowledgement.as_deref() != Some(expected.as_str()) {
            uncertainty.get_or_insert_with(|| {
                format!(
                    "escaped cleanup acknowledgement mismatch: expected {expected}, got {acknowledgement:?}"
                )
            });
        }
        match uncertainty {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_process_is_live(pid: u32) -> bool {
        let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        let Some((_, after_name)) = stat.rsplit_once(") ") else {
            return true;
        };
        !matches!(after_name.as_bytes().first(), Some(b'Z') | Some(b'X'))
    }

    #[cfg(target_os = "linux")]
    async fn assert_linux_process_stopped(pid: u32) {
        let deadline = time::Instant::now() + Duration::from_secs(2);
        while linux_process_is_live(pid) && time::Instant::now() < deadline {
            time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!linux_process_is_live(pid), "process {pid} remained alive");
    }

    fn spawn_existing_session_actor(
        session: RuntimeSession,
    ) -> (Arc<RuntimeSupervisor>, JoinHandle<()>) {
        let (requests, mut receiver) = mpsc::channel(8);
        let (shutdown_signal, _shutdown_receiver) = watch::channel(false);
        let supervisor = Arc::new(RuntimeSupervisor {
            requests,
            lifecycle: Arc::new(AtomicU8::new(LIFECYCLE_RUNNING)),
            lifecycle_gate: Arc::new(Mutex::new(())),
            shutdown_signal,
        });
        let actor = tokio::spawn(async move {
            let mut session = Some(session);
            while let Some(request) = receiver.recv().await {
                match request {
                    SupervisorRequest::Bootstrap {
                        renderer_origin,
                        response,
                    } => {
                        let result = session
                            .as_mut()
                            .map_or(Err(RuntimeSupervisorError::Unavailable), |active| {
                                bootstrap_active_session(active, &renderer_origin)
                            });
                        let _ = response.send(result);
                    }
                    SupervisorRequest::Restart { response, .. } => {
                        let _ = response.send(Err(RuntimeSupervisorError::Unavailable));
                    }
                    SupervisorRequest::Shutdown { reason, response } => {
                        let result = match session.take() {
                            Some(active) => {
                                active
                                    .shutdown(
                                        reason,
                                        HOST_DEADLINE,
                                        GRACEFUL_TIMEOUT,
                                        FORCE_TIMEOUT,
                                    )
                                    .await
                            }
                            None => Ok(()),
                        };
                        let _ = response.send(result);
                        break;
                    }
                }
            }
            if let Some(mut active) = session {
                let _ = active.force_cleanup(FORCE_TIMEOUT).await;
            }
        });
        (supervisor, actor)
    }

    #[test]
    fn redacts_a_secret_even_when_it_crosses_every_chunk_boundary() {
        let secret = "fixture-access-token";
        for cut in 1..secret.len() {
            let mut redactor = SecretRedactor::new(secret);
            let mut output = redactor.push(&secret.as_bytes()[..cut]);
            output.extend(redactor.push(&secret.as_bytes()[cut..]));
            output.extend(redactor.finish());
            assert_eq!(output, b"[REDACTED]");
        }
    }

    #[test]
    fn accepts_only_bundled_asset_origins() {
        assert_eq!(
            allowed_renderer_origin("tauri://localhost/"),
            Some("tauri://localhost".to_owned())
        );
        assert_eq!(
            allowed_renderer_origin("http://tauri.localhost/"),
            Some("http://tauri.localhost".to_owned())
        );
        assert_eq!(
            allowed_renderer_origin("tauri://localhost/?conversation=fixture#message"),
            Some("tauri://localhost".to_owned())
        );
        assert_eq!(
            allowed_renderer_origin("http://tauri.localhost/?conversation=fixture#message"),
            Some("http://tauri.localhost".to_owned())
        );
        assert_eq!(allowed_renderer_origin("http://127.0.0.1:1430/"), None);
        assert_eq!(allowed_renderer_origin("https://example.com/"), None);
        assert_eq!(allowed_renderer_origin("null"), None);
    }

    #[test]
    fn sticky_runtime_failure_blocks_bootstrap() {
        let lifecycle = AtomicU8::new(LIFECYCLE_RUNNING);
        assert!(bootstrap_is_available(&lifecycle, false));
        assert!(!bootstrap_is_available(&lifecycle, true));
        lifecycle.store(LIFECYCLE_SHUTTING_DOWN, Ordering::SeqCst);
        assert!(!bootstrap_is_available(&lifecycle, false));
    }

    #[test]
    fn runtime_environment_scrubs_inherited_credentials_case_insensitively() {
        // The helper is based on the real environment. Its invariant is that only the two canonical
        // managed variables can survive, regardless of inherited key casing.
        let environment = sanitized_runtime_environment();
        for (name, value) in &environment {
            let normalized = name.to_string_lossy().to_uppercase();
            assert_ne!(normalized, "PI_WORKBENCH_SETTINGS_FILE");
            if normalized.starts_with("WORKBENCH_") {
                assert_eq!(normalized, "WORKBENCH_RUNTIME_MANAGED_CHILD");
                assert_eq!(value, "1");
            }
            if normalized.starts_with("NODE_") {
                assert_eq!(normalized, "NODE_ENV");
                assert_eq!(value, "production");
            }
        }
    }

    #[test]
    fn connection_serialization_uses_the_public_runtime_connection_shape() {
        let connection = RuntimeConnectionDescriptor {
            kind: "desktop-sidecar",
            protocol_version: 1,
            http_origin: "http://127.0.0.1:43127".to_owned(),
            instance_id: "runtime-fixture".to_owned(),
            access_token: "fixture-access-token".to_owned(),
        };
        assert_eq!(
            serde_json::to_string(&connection).unwrap(),
            r#"{"kind":"desktop-sidecar","protocolVersion":1,"httpOrigin":"http://127.0.0.1:43127","instanceId":"runtime-fixture","accessToken":"fixture-access-token"}"#
        );
        let debug = format!("{connection:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("fixture-access-token"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn scripted_child_accepts_only_stdin_token_and_reports_its_exact_pid() {
        let instance_id = "exact-ready-fixture";
        let port = available_loopback_port();
        let access_token = fixture_token("exact-ready");
        let mut command = scripted_command("happy", instance_id, port);
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::Requested,
            HOST_DEADLINE,
        );

        let session = start_scripted(command, access_token.clone(), STARTUP_TIMEOUT)
            .await
            .expect("scripted child should become ready");
        let child_pid = session.child.id().expect("scripted child pid");
        assert_ne!(child_pid, 0);
        #[cfg(unix)]
        {
            let watchdog_process_group = session.watchdog.process_group();
            assert_ne!(child_pid, watchdog_process_group);
            // SAFETY: getpgid only inspects the live direct-child PID.
            assert_eq!(
                unsafe { libc::getpgid(child_pid as libc::pid_t) },
                watchdog_process_group as libc::pid_t
            );
        }
        assert_eq!(session.connection.kind, "desktop-sidecar");
        assert_eq!(session.connection.protocol_version, 1);
        assert_eq!(
            session.connection.http_origin,
            format!("http://127.0.0.1:{port}")
        );
        assert_eq!(session.connection.instance_id, instance_id);
        assert_eq!(session.connection.access_token, access_token);

        session
            .shutdown(
                RuntimeHostShutdownReason::Requested,
                HOST_DEADLINE,
                GRACEFUL_TIMEOUT,
                FORCE_TIMEOUT,
            )
            .await
            .expect("shutdown ack and child exit should be clean");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_drains_the_old_listener_before_starting_its_replacement() {
        let port = available_loopback_port();
        let mut first_command = scripted_command("restartable", "restart-first", port);
        expect_shutdown_frame(
            &mut first_command,
            RuntimeHostShutdownReason::Restart,
            DEFAULT_HOST_SHUTDOWN_DEADLINE,
        );
        let first = start_scripted(
            first_command,
            fixture_token("restart-first"),
            STARTUP_TIMEOUT,
        )
        .await
        .expect("first generation should become ready");

        let mut second_command = scripted_command("restartable", "restart-second", port);
        expect_shutdown_frame(
            &mut second_command,
            RuntimeHostShutdownReason::Requested,
            HOST_DEADLINE,
        );
        let second = restart_after_drain(
            first,
            start_scripted(
                second_command,
                fixture_token("restart-second"),
                STARTUP_TIMEOUT,
            ),
        )
        .await
        .expect("replacement should bind only after the first listener is drained");
        assert_eq!(second.connection.instance_id, "restart-second");
        assert_eq!(
            second.connection.http_origin,
            format!("http://127.0.0.1:{port}")
        );

        second
            .shutdown(
                RuntimeHostShutdownReason::Requested,
                HOST_DEADLINE,
                GRACEFUL_TIMEOUT,
                FORCE_TIMEOUT,
            )
            .await
            .expect("replacement shutdown should be clean");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_rejects_and_cleans_a_reused_instance_id() {
        let port = available_loopback_port();
        let instance_id = "restart-reused-instance";
        let mut first_command = scripted_command("restartable", instance_id, port);
        expect_shutdown_frame(
            &mut first_command,
            RuntimeHostShutdownReason::Restart,
            DEFAULT_HOST_SHUTDOWN_DEADLINE,
        );
        let first = start_scripted(
            first_command,
            fixture_token("restart-reused-first"),
            STARTUP_TIMEOUT,
        )
        .await
        .expect("first generation should become ready");
        let second_command = scripted_command("restartable", instance_id, port);
        let result = restart_after_drain(
            first,
            start_scripted(
                second_command,
                fixture_token("restart-reused-second"),
                STARTUP_TIMEOUT,
            ),
        )
        .await;
        match result {
            Err(RuntimeSupervisorError::ProtocolFailed) => {}
            Err(error) => panic!("unexpected reused-instance result: {error}"),
            Ok(mut replacement) => {
                let _ = replacement.force_cleanup(FORCE_TIMEOUT).await;
                panic!("reused Runtime instance ID was published");
            }
        }
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .expect("rejected replacement listener should be drained");
        drop(listener);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rejects_startup_error_wrong_pid_crash_and_unexpected_or_duplicate_frames() {
        for (scenario, expected) in [
            ("startup-error", RuntimeSupervisorError::StartupRejected),
            ("wrong-pid", RuntimeSupervisorError::ProtocolFailed),
            ("crash-before-ready", RuntimeSupervisorError::ProtocolFailed),
            (
                "unexpected-before-ready",
                RuntimeSupervisorError::ProtocolFailed,
            ),
        ] {
            assert_start_error(scenario, expected, STARTUP_TIMEOUT).await;
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn duplicate_ready_is_rejected_before_connection_reuse() {
        let token = fixture_token("duplicate-ready");
        let command = scripted_command(
            "duplicate-ready",
            "duplicate-ready-fixture",
            available_loopback_port(),
        );
        match start_scripted(command, token, STARTUP_TIMEOUT).await {
            Err(error) => assert_eq!(error, RuntimeSupervisorError::ProtocolFailed),
            Ok(mut session) => {
                time::timeout(STARTUP_TIMEOUT, async {
                    loop {
                        if session.assert_running_and_drained().is_err() {
                            return;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .expect("duplicate ready must become observable before connection reuse");
                session
                    .force_cleanup(FORCE_TIMEOUT)
                    .await
                    .expect("duplicate-ready child cleanup");
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ready_timeout_forces_the_scripted_child_down() {
        assert_start_error(
            "ready-timeout",
            RuntimeSupervisorError::StartupTimedOut,
            Duration::from_millis(150),
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn crash_after_ready_is_detected_before_connection_reuse() {
        let command = scripted_command(
            "crash-after-ready",
            "crash-after-ready",
            available_loopback_port(),
        );
        let mut session =
            start_scripted(command, fixture_token("crash-after-ready"), STARTUP_TIMEOUT)
                .await
                .expect("fixture should publish ready before crashing");
        time::sleep(Duration::from_millis(250)).await;
        assert_eq!(
            session.assert_running_and_drained(),
            Err(RuntimeSupervisorError::ProtocolFailed)
        );
        let _ = session.force_cleanup(FORCE_TIMEOUT).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rejects_exit_before_ack_ack_without_exit_and_duplicate_ack() {
        for scenario in ["exit-before-ack", "ack-no-exit", "duplicate-ack"] {
            let mut command = scripted_command(scenario, scenario, available_loopback_port());
            expect_shutdown_frame(
                &mut command,
                RuntimeHostShutdownReason::Requested,
                HOST_DEADLINE,
            );
            let session = start_scripted(command, fixture_token(scenario), STARTUP_TIMEOUT)
                .await
                .expect("fixture should become ready");
            assert_eq!(
                session
                    .shutdown(
                        RuntimeHostShutdownReason::Requested,
                        HOST_DEADLINE,
                        Duration::from_millis(300),
                        FORCE_TIMEOUT,
                    )
                    .await,
                Err(RuntimeSupervisorError::ShutdownFailed),
                "scenario {scenario}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn host_deadline_does_not_consume_the_supervisors_graceful_margin() {
        let host_deadline = Duration::from_millis(80);
        let mut command = scripted_command("late-ack", "late-ack", available_loopback_port());
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::ContainerExit,
            host_deadline,
        );
        let session = start_scripted(command, fixture_token("late-ack"), STARTUP_TIMEOUT)
            .await
            .expect("fixture should become ready");
        session
            .shutdown(
                RuntimeHostShutdownReason::ContainerExit,
                host_deadline,
                Duration::from_millis(800),
                FORCE_TIMEOUT,
            )
            .await
            .expect("ack after host deadline but before total deadline should succeed");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn exit_cancellation_interrupts_startup_and_cleans_the_child() {
        let marker = unique_marker_path("startup-cancel");
        let mut command =
            scripted_command("ready-timeout", "startup-cancel", available_loopback_port());
        command.env("RUNTIME_FIXTURE_PID_FILE", &marker);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let start = tokio::spawn(RuntimeSession::start(
            command,
            FIXTURE_ORIGIN.to_owned(),
            fixture_token("startup-cancel"),
            Duration::from_secs(10),
            Some(shutdown_receiver),
        ));
        let pid = wait_for_pid_file(&marker).await;
        shutdown_sender.send_replace(true);
        let result = time::timeout(Duration::from_secs(2), start)
            .await
            .expect("startup cancellation should be prompt")
            .expect("startup task should not panic");
        match result {
            Err(error) => assert_eq!(error, RuntimeSupervisorError::Unavailable),
            Ok(mut session) => {
                let _ = session.force_cleanup(FORCE_TIMEOUT).await;
                panic!("cancelled startup unexpectedly returned a session");
            }
        }
        #[cfg(target_os = "linux")]
        assert_linux_process_stopped(pid).await;
        let _ = fs::remove_file(marker);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn concurrent_bootstrap_reuses_one_connection_and_rejects_another_origin() {
        let mut command = scripted_command("happy", "actor-bootstrap", available_loopback_port());
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::Requested,
            HOST_DEADLINE,
        );
        let session = start_scripted(command, fixture_token("actor"), STARTUP_TIMEOUT)
            .await
            .expect("fixture should become ready");
        let expected = session.connection.clone();
        let (supervisor, actor) = spawn_existing_session_actor(session);
        let first = Arc::clone(&supervisor);
        let second = Arc::clone(&supervisor);
        let other = Arc::clone(&supervisor);
        let (first, second, other) = tokio::join!(
            first.bootstrap(FIXTURE_ORIGIN.to_owned()),
            second.bootstrap(FIXTURE_ORIGIN.to_owned()),
            other.bootstrap("http://tauri.localhost".to_owned()),
        );
        assert_eq!(first.expect("first bootstrap"), expected);
        assert_eq!(second.expect("second bootstrap"), expected);
        assert_eq!(other, Err(RuntimeSupervisorError::OriginRejected));
        supervisor
            .shutdown(RuntimeHostShutdownReason::Requested)
            .await
            .expect("actor fixture shutdown");
        drop(supervisor);
        actor.await.expect("fixture actor should stop");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn scripted_stderr_token_is_redacted_across_reader_chunks() {
        let port = available_loopback_port();
        let access_token = fixture_token("stderr-split");
        let mut command = scripted_command("stderr-split", "stderr-split", port);
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::Requested,
            HOST_DEADLINE,
        );
        let mut child = Command::from(command)
            .spawn()
            .expect("spawn raw stderr fixture");
        let child_pid = child.id().expect("raw fixture pid");
        let mut stdin = child.stdin.take().expect("raw fixture stdin");
        let stdout = child.stdout.take().expect("raw fixture stdout");
        let mut stderr = child.stderr.take().expect("raw fixture stderr");
        let (control_sender, mut control_events) = mpsc::channel(8);
        let stdout_task = tokio::spawn(read_control_stdout(stdout, control_sender));
        let redaction_token = access_token.clone();
        let stderr_task = tokio::spawn(async move {
            let mut redactor = SecretRedactor::new(&redaction_token);
            let mut output = Vec::new();
            let mut chunk = [0_u8; 8_192];
            loop {
                let count = stderr.read(&mut chunk).await.expect("read fixture stderr");
                if count == 0 {
                    output.extend(redactor.finish());
                    return output;
                }
                output.extend(redactor.push(&chunk[..count]));
            }
        });
        let start = RuntimeHostControlInputFrame::Start(
            RuntimeHostStartFrame::new(access_token.clone(), [FIXTURE_ORIGIN.to_owned()])
                .expect("valid fixture start"),
        );
        stdin
            .write_all(
                &encode_runtime_host_control_input_frame(&start).expect("encode fixture start"),
            )
            .await
            .expect("write fixture start");
        stdin.flush().await.expect("flush fixture start");
        match time::timeout(STARTUP_TIMEOUT, control_events.recv())
            .await
            .expect("fixture ready timeout")
        {
            Some(ControlEvent::Frame(RuntimeHostControlOutputFrame::Ready(ready))) => {
                assert_eq!(ready.pid, u64::from(child_pid));
                assert_eq!(ready.instance_id, "stderr-split");
                assert_eq!(ready.http_origin, format!("http://127.0.0.1:{port}"));
            }
            other => panic!("unexpected ready event: {other:?}"),
        }
        let shutdown = RuntimeHostControlInputFrame::Shutdown(
            RuntimeHostShutdownFrame::new(RuntimeHostShutdownReason::Requested, 100)
                .expect("valid fixture shutdown"),
        );
        stdin
            .write_all(
                &encode_runtime_host_control_input_frame(&shutdown)
                    .expect("encode fixture shutdown"),
            )
            .await
            .expect("write fixture shutdown");
        stdin.flush().await.expect("flush fixture shutdown");
        assert!(matches!(
            time::timeout(GRACEFUL_TIMEOUT, control_events.recv()).await,
            Ok(Some(ControlEvent::Frame(
                RuntimeHostControlOutputFrame::ShutdownAck
            )))
        ));
        stdin.shutdown().await.expect("close fixture stdin");
        let status = time::timeout(GRACEFUL_TIMEOUT, child.wait())
            .await
            .expect("fixture exit timeout")
            .expect("wait for fixture");
        assert!(status.success());
        stdout_task.await.expect("stdout task");
        assert!(matches!(
            control_events.recv().await,
            Some(ControlEvent::End)
        ));
        let diagnostics = stderr_task.await.expect("stderr task");
        assert!(
            diagnostics
                .windows(b"[REDACTED]".len())
                .any(|window| window == b"[REDACTED]")
        );
        assert!(
            !diagnostics
                .windows(access_token.len())
                .any(|window| window == access_token.as_bytes())
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test(flavor = "multi_thread")]
    async fn watchdog_closes_the_exact_group_after_host_ack_and_exit() {
        let grandchild_marker = unique_marker_path("grandchild");
        let mut command = scripted_command(
            "grandchild-inherited-stderr",
            "grandchild",
            available_loopback_port(),
        );
        command.env("RUNTIME_FIXTURE_GRANDCHILD_PID_FILE", &grandchild_marker);
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::ContainerExit,
            HOST_DEADLINE,
        );
        let session = start_scripted(command, fixture_token("grandchild"), STARTUP_TIMEOUT)
            .await
            .expect("grandchild fixture should become ready");
        session
            .shutdown(
                RuntimeHostShutdownReason::ContainerExit,
                HOST_DEADLINE,
                Duration::from_millis(300),
                FORCE_TIMEOUT,
            )
            .await
            .expect("watchdog should close and prove the exact process group empty");
        let grandchild_pid = wait_for_pid_file(&grandchild_marker).await;
        assert_linux_process_stopped(grandchild_pid).await;
        let _ = fs::remove_file(grandchild_marker);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test(flavor = "multi_thread")]
    async fn unexpected_watchdog_health_eof_is_a_sticky_cleanup_failure() {
        let command = scripted_command(
            "happy",
            "watchdog-health-failure",
            available_loopback_port(),
        );
        let mut session = start_scripted(
            command,
            fixture_token("watchdog-health-failure"),
            STARTUP_TIMEOUT,
        )
        .await
        .expect("fixture should become ready");
        let host_pid = session.child.id().expect("fixture Host PID");
        let watchdog_pid = session.watchdog.process_group();
        // SAFETY: the test owns the exact, live watchdog identity and signals only that PID.
        assert_eq!(
            unsafe { libc::kill(watchdog_pid as libc::pid_t, libc::SIGKILL) },
            0
        );
        time::timeout(STARTUP_TIMEOUT, session.watchdog.wait_for_failure())
            .await
            .expect("watchdog health EOF should be prompt");
        assert_eq!(
            session
                .cleanup_after_error(RuntimeSupervisorError::ProtocolFailed)
                .await,
            RuntimeSupervisorError::ShutdownFailed
        );
        assert_linux_process_stopped(host_pid).await;
    }

    #[cfg(target_os = "linux")]
    #[tokio::test(flavor = "multi_thread")]
    async fn escaped_setsid_descendant_is_an_explicit_exact_pgid_containment_boundary() {
        // Negative capability-boundary test: this must never be counted as an orphan-cleanup pass.
        // A descendant that calls setsid(2) is outside the Runtime Host's exact PGID. We prove that
        // it survives HUP, TERM, and supervisor cleanup, then make it SIGKILL itself only after an
        // exact PID + /proc starttime handshake so PID reuse cannot target an unrelated process.
        let identity_file = unique_marker_path("escaped-identity");
        let signal_ack_file = unique_marker_path("escaped-signal-ack");
        let cleanup_file = unique_marker_path("escaped-cleanup");
        let cleanup_ack_file = unique_marker_path("escaped-cleanup-ack");
        let mut command = scripted_command(
            "escaped-setsid-descendant",
            "escaped-setsid-descendant",
            available_loopback_port(),
        );
        command
            .env("RUNTIME_FIXTURE_ESCAPED_PID_FILE", &identity_file)
            .env("RUNTIME_FIXTURE_ESCAPED_SIGNAL_ACK_FILE", &signal_ack_file)
            .env("RUNTIME_FIXTURE_ESCAPED_CLEANUP_FILE", &cleanup_file)
            .env(
                "RUNTIME_FIXTURE_ESCAPED_CLEANUP_ACK_FILE",
                &cleanup_ack_file,
            );
        expect_shutdown_frame(
            &mut command,
            RuntimeHostShutdownReason::ContainerExit,
            HOST_DEADLINE,
        );
        let session = start_scripted(
            command,
            fixture_token("escaped-setsid-descendant"),
            STARTUP_TIMEOUT,
        )
        .await
        .expect("escaped-descendant fixture should become ready");
        let supervised_pid = session.child.id().expect("supervised fixture pid");
        let shutdown_result = session
            .shutdown(
                RuntimeHostShutdownReason::ContainerExit,
                HOST_DEADLINE,
                Duration::from_millis(300),
                FORCE_TIMEOUT,
            )
            .await;

        let identity_json = match wait_for_nonempty_file(&identity_file, STARTUP_TIMEOUT).await {
            Ok(identity) => identity,
            Err(error) => {
                // The fixture's identity-local watchdog is the only safe fallback when no PID and
                // starttime were published; wait for it instead of guessing at a process to kill.
                time::sleep(Duration::from_secs(11)).await;
                panic!("escaped descendant identity unavailable: {error}");
            }
        };
        let identity: EscapedDescendantIdentity = match serde_json::from_str(&identity_json) {
            Ok(identity) => identity,
            Err(error) => {
                time::sleep(Duration::from_secs(11)).await;
                panic!("escaped descendant identity was invalid: {error}");
            }
        };
        let signal_ack = wait_for_nonempty_file(&signal_ack_file, STARTUP_TIMEOUT).await;
        let mut failures = Vec::new();
        if shutdown_result != Err(RuntimeSupervisorError::ShutdownFailed) {
            failures.push(format!(
                "expected inherited-pipe shutdown failure, got {shutdown_result:?}"
            ));
        }
        if identity.pid == supervised_pid
            || identity.pgrp != identity.pid
            || identity.session != identity.pid
            || identity.pgrp == supervised_pid
        {
            failures.push(format!(
                "setsid identity did not escape the supervised PGID {supervised_pid}: {identity:?}"
            ));
        }
        match signal_ack {
            Ok(acknowledgement) if acknowledgement == identity_json => {}
            other => failures.push(format!(
                "fixture did not prove HUP/TERM survival for the exact identity: {other:?}"
            )),
        }
        match linux_process_starttime(identity.pid) {
            Ok(Some(starttime)) if starttime == identity.starttime => {}
            other => failures.push(format!(
                "escaped identity was not alive after exact-PGID cleanup: {other:?}"
            )),
        }

        if let Err(error) =
            precisely_cleanup_escaped_descendant(&identity, &cleanup_file, &cleanup_ack_file).await
        {
            failures.push(format!("exact escaped-descendant cleanup failed: {error}"));
        }
        for path in [
            identity_file,
            signal_ack_file,
            cleanup_file,
            cleanup_ack_file,
        ] {
            let _ = fs::remove_file(path);
        }
        assert!(failures.is_empty(), "{}", failures.join("; "));
    }

    #[test]
    fn exit_state_prevents_every_request_until_the_final_programmatic_exit() {
        let (requests, _receiver) = mpsc::channel(1);
        let (shutdown_signal, shutdown_receiver) = watch::channel(false);
        let supervisor = RuntimeSupervisor {
            requests,
            lifecycle: Arc::new(AtomicU8::new(LIFECYCLE_RUNNING)),
            lifecycle_gate: Arc::new(Mutex::new(())),
            shutdown_signal,
        };
        assert!(!*shutdown_receiver.borrow());
        assert_eq!(
            supervisor.exit_disposition(),
            ExitDisposition::StartShutdown
        );
        assert!(*shutdown_receiver.borrow());
        assert_eq!(
            supervisor.exit_disposition(),
            ExitDisposition::WaitForShutdown
        );
        supervisor.allow_exit();
        assert_eq!(supervisor.exit_disposition(), ExitDisposition::AllowExit);
    }
}
