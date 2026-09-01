use std::{
    env,
    ffi::OsStr,
    io::{self, Read, Write},
    os::unix::{
        io::AsRawFd,
        process::{CommandExt as _, ExitStatusExt as _},
    },
    process::{Command as StdCommand, Stdio},
    time::Duration,
};

use tokio::{
    io::AsyncReadExt as _,
    process::{Child, ChildStdin, ChildStdout},
    sync::{mpsc, watch},
    task::JoinHandle,
    time,
};

pub(crate) const PRIVATE_MODE_ARGUMENT: &str = "--workbench-runtime-watchdog-v1";
const READY_PREFIX: &str = "WORKBENCH_RUNTIME_WATCHDOG_READY_V1 ";
const PRIVATE_MODE_USAGE_ERROR: i32 = 64;
const PRIVATE_MODE_NOT_GROUP_LEADER: i32 = 65;
const PRIVATE_MODE_READY_ERROR: i32 = 66;
const PRIVATE_MODE_KILL_ERROR: i32 = 67;
const WATCHDOG_RESPONSE_TIMEOUT: Duration = Duration::from_secs(1);
const FAILED_SPAWN_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HealthEvent {
    Eof,
    UnexpectedOutput,
    ReadFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatchdogSpawnError {
    Failed,
    Cancelled,
    CleanupFailed,
}

/// Runs the private watchdog mode before Tauri initializes.
///
/// Merely mentioning the private argument is enough to keep malformed manual invocations out of
/// the application path. Only the exact one-argument form is allowed to arm a process group.
pub(crate) fn private_mode_exit_code() -> Option<i32> {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    let requested = arguments
        .iter()
        .any(|argument| argument == OsStr::new(PRIVATE_MODE_ARGUMENT));
    if !requested {
        return None;
    }
    if arguments.as_slice() != [OsStr::new(PRIVATE_MODE_ARGUMENT)] {
        return Some(PRIVATE_MODE_USAGE_ERROR);
    }
    Some(run_stdio_watchdog())
}

fn run_stdio_watchdog() -> i32 {
    // SAFETY: getpid/getpgrp only inspect the calling process and have no preconditions.
    let (pid, process_group) = unsafe { (libc::getpid(), libc::getpgrp()) };
    if pid <= 1 || process_group != pid {
        return PRIVATE_MODE_NOT_GROUP_LEADER;
    }

    let mut stdout = io::stdout().lock();
    if writeln!(stdout, "{READY_PREFIX}{pid}")
        .and_then(|()| stdout.flush())
        .is_err()
    {
        return kill_verified_process_group(process_group, PRIVATE_MODE_READY_ERROR);
    }

    // The pipe is a one-way liveness capability, not a command channel. Bytes have no meaning and
    // can never disarm the watchdog; EOF (or a read failure) always triggers exact-PGID SIGKILL.
    let mut stdin = io::stdin().lock();
    let mut buffer = [0_u8; 256];
    loop {
        match stdin.read(&mut buffer) {
            Ok(0) | Err(_) => {
                return kill_verified_process_group(process_group, PRIVATE_MODE_KILL_ERROR);
            }
            Ok(_) => {}
        }
    }
}

fn kill_verified_process_group(process_group: libc::pid_t, failure_code: i32) -> i32 {
    if process_group <= 1 {
        return failure_code;
    }
    // SAFETY: the caller proved that the positive PGID equals this process's PID. The watchdog
    // remains the group leader until this call, so the identity cannot be recycled underneath it.
    if unsafe { libc::killpg(process_group, libc::SIGKILL) } == 0 {
        // A successful group SIGKILL includes this process, so this is unreachable in the normal
        // case. _exit avoids unwinding or emitting diagnostics if delivery is anomalously delayed.
        unsafe { libc::_exit(failure_code) }
    }
    failure_code
}

fn production_watchdog_command() -> Result<StdCommand, ()> {
    let executable = env::current_exe().map_err(|_| ())?;
    let metadata = std::fs::symlink_metadata(&executable).map_err(|_| ())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(());
    }
    let executable = std::fs::canonicalize(executable).map_err(|_| ())?;
    let mut command = StdCommand::new(executable);
    command.env_clear().arg(PRIVATE_MODE_ARGUMENT);
    Ok(command)
}

#[cfg(test)]
fn watchdog_command() -> Result<StdCommand, ()> {
    // Unit tests exercise the production parent-side launch/join/cleanup seam. The private mode
    // itself is exercised through the real application executable in tests/unix_watchdog.rs.
    let script = format!(
        r#"
pid=$$
pgid=$(/bin/ps -o pgid= -p "$pid") || exit {PRIVATE_MODE_NOT_GROUP_LEADER}
set -- $pgid
[ "$#" -eq 1 ] || exit {PRIVATE_MODE_NOT_GROUP_LEADER}
[ "$pid" -eq "$1" ] || exit {PRIVATE_MODE_NOT_GROUP_LEADER}
printf '{READY_PREFIX}%s\n' "$pid" || exit {PRIVATE_MODE_READY_ERROR}
while IFS= read -r ignored; do :; done
kill -KILL "-$pid"
exit {PRIVATE_MODE_KILL_ERROR}
"#
    );
    let mut command = StdCommand::new("/bin/sh");
    command.env_clear().arg("-c").arg(script);
    Ok(command)
}

#[cfg(not(test))]
fn watchdog_command() -> Result<StdCommand, ()> {
    production_watchdog_command()
}

fn set_close_on_exec(file_descriptor: libc::c_int) -> Result<(), ()> {
    // SAFETY: fcntl reads/updates flags for an owned, live file descriptor.
    let flags = unsafe { libc::fcntl(file_descriptor, libc::F_GETFD) };
    if flags == -1 {
        return Err(());
    }
    // SAFETY: the descriptor remains owned by the ChildStdin value for the duration of this call.
    if unsafe { libc::fcntl(file_descriptor, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 {
        return Err(());
    }
    Ok(())
}

async fn read_exact_ready(stdout: &mut ChildStdout, expected: &[u8]) -> Result<(), ()> {
    let mut ready = Vec::with_capacity(expected.len());
    while ready.len() < expected.len() {
        let byte = stdout.read_u8().await.map_err(|_| ())?;
        ready.push(byte);
    }
    if ready == expected { Ok(()) } else { Err(()) }
}

fn direct_kill_process_group(process_group: u32) -> Result<(), ()> {
    let process_group = libc::pid_t::try_from(process_group).map_err(|_| ())?;
    if process_group <= 1 {
        return Err(());
    }
    // SAFETY: UnixWatchdog only stores a positive, identity-verified direct-child PGID.
    let result = unsafe { libc::killpg(process_group, libc::SIGKILL) };
    if result == 0 {
        return Ok(());
    }
    match io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(()),
        _ => Err(()),
    }
}

fn process_group_matches_child(process_group: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(process_group) else {
        return false;
    };
    if pid <= 1 {
        return false;
    }
    // SAFETY: getpgid only inspects the live direct-child PID.
    unsafe { libc::getpgid(pid) == pid }
}

async fn wait_for_empty_process_group(
    process_group: u32,
    deadline: time::Instant,
) -> Result<(), ()> {
    let process_group = libc::pid_t::try_from(process_group).map_err(|_| ())?;
    if process_group <= 1 {
        return Err(());
    }
    loop {
        // SAFETY: signal 0 only probes the verified positive PGID; it never sends a signal.
        let result = unsafe { libc::killpg(process_group, 0) };
        if result == -1 {
            match io::Error::last_os_error().raw_os_error() {
                Some(libc::ESRCH) => return Ok(()),
                Some(libc::EPERM) => {}
                _ => return Err(()),
            }
        }
        let remaining = deadline
            .checked_duration_since(time::Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .ok_or(())?;
        time::sleep(remaining.min(Duration::from_millis(10))).await;
    }
}

async fn cleanup_failed_spawn(
    child: &mut Child,
    liveness: &mut Option<ChildStdin>,
    process_group: u32,
) -> Result<(), ()> {
    liveness.take();
    let deadline = time::Instant::now() + FAILED_SPAWN_CLEANUP_TIMEOUT;
    let kill_result = direct_kill_process_group(process_group);
    let child_result = match deadline.checked_duration_since(time::Instant::now()) {
        Some(remaining) if !remaining.is_zero() => {
            matches!(time::timeout(remaining, child.wait()).await, Ok(Ok(_)))
        }
        _ => false,
    };
    let empty_result = wait_for_empty_process_group(process_group, deadline).await;
    if kill_result.is_ok() && child_result && empty_result.is_ok() {
        Ok(())
    } else {
        Err(())
    }
}

async fn cleanup_unidentified_spawn(child: &mut Child) -> Result<(), ()> {
    let deadline = time::Instant::now() + FAILED_SPAWN_CLEANUP_TIMEOUT;
    if child.start_kill().is_err() {
        return Err(());
    }
    match deadline.checked_duration_since(time::Instant::now()) {
        Some(remaining) if !remaining.is_zero() => {
            if matches!(time::timeout(remaining, child.wait()).await, Ok(Ok(_))) {
                Ok(())
            } else {
                Err(())
            }
        }
        _ => Err(()),
    }
}

fn spawn_error_after_cleanup(
    original: WatchdogSpawnError,
    cleanup: Result<(), ()>,
) -> WatchdogSpawnError {
    if cleanup.is_ok() {
        original
    } else {
        WatchdogSpawnError::CleanupFailed
    }
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
        if *receiver.borrow() || receiver.changed().await.is_err() {
            return;
        }
    }
}

pub(crate) struct UnixWatchdog {
    process_group: u32,
    child: Child,
    liveness: Option<ChildStdin>,
    health_events: mpsc::Receiver<HealthEvent>,
    health_task: Option<JoinHandle<()>>,
}

impl UnixWatchdog {
    pub(crate) async fn spawn(
        deadline: time::Instant,
        shutdown_signal: &mut Option<watch::Receiver<bool>>,
    ) -> Result<Self, WatchdogSpawnError> {
        if cancellation_is_requested(shutdown_signal) {
            return Err(WatchdogSpawnError::Cancelled);
        }
        let mut command = watchdog_command().map_err(|_| WatchdogSpawnError::Failed)?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = tokio::process::Command::from(command)
            .spawn()
            .map_err(|_| WatchdogSpawnError::Failed)?;
        let Some(process_group) = child.id().filter(|pid| *pid > 1) else {
            let cleanup = cleanup_unidentified_spawn(&mut child).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        };
        let mut liveness = child.stdin.take();
        if !process_group_matches_child(process_group) {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        }
        let Some(liveness_writer) = liveness.as_ref() else {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        };
        if set_close_on_exec(liveness_writer.as_raw_fd()).is_err() {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        }
        let Some(mut stdout) = child.stdout.take() else {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        };
        let expected = format!("{READY_PREFIX}{process_group}\n");
        let Some(remaining) = deadline
            .checked_duration_since(time::Instant::now())
            .filter(|remaining| !remaining.is_zero())
        else {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        };
        let ready_result = tokio::select! {
            biased;
            _ = wait_for_cancellation(shutdown_signal) => {
                Err(WatchdogSpawnError::Cancelled)
            }
            result = time::timeout(
                remaining,
                read_exact_ready(&mut stdout, expected.as_bytes()),
            ) => {
                if matches!(result, Ok(Ok(()))) {
                    Ok(())
                } else {
                    Err(WatchdogSpawnError::Failed)
                }
            }
        };
        if let Err(original) = ready_result {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(original, cleanup));
        }
        if !process_group_matches_child(process_group) || !matches!(child.try_wait(), Ok(None)) {
            let cleanup = cleanup_failed_spawn(&mut child, &mut liveness, process_group).await;
            return Err(spawn_error_after_cleanup(
                WatchdogSpawnError::Failed,
                cleanup,
            ));
        }

        let (health_sender, health_events) = mpsc::channel(1);
        let health_task = tokio::spawn(async move {
            let mut byte = [0_u8; 1];
            let event = match stdout.read(&mut byte).await {
                Ok(0) => HealthEvent::Eof,
                Ok(_) => HealthEvent::UnexpectedOutput,
                Err(_) => HealthEvent::ReadFailed,
            };
            let _ = health_sender.send(event).await;
        });
        Ok(Self {
            process_group,
            child,
            liveness,
            health_events,
            health_task: Some(health_task),
        })
    }

    #[cfg(test)]
    pub(crate) fn process_group(&self) -> u32 {
        self.process_group
    }

    pub(crate) fn configure_runtime_command(&self, command: &mut StdCommand) -> Result<(), ()> {
        let process_group = i32::try_from(self.process_group).map_err(|_| ())?;
        if process_group <= 1 {
            return Err(());
        }
        command.process_group(process_group);
        Ok(())
    }

    pub(crate) fn assert_healthy(&mut self) -> Result<(), ()> {
        if self.child.try_wait().map_err(|_| ())?.is_some() {
            return Err(());
        }
        match self.health_events.try_recv() {
            Err(mpsc::error::TryRecvError::Empty) => Ok(()),
            Ok(_) | Err(mpsc::error::TryRecvError::Disconnected) => Err(()),
        }
    }

    pub(crate) async fn wait_for_failure(&mut self) {
        let _ = self.health_events.recv().await;
    }

    pub(crate) async fn terminate(&mut self, deadline: time::Instant) -> Result<(), ()> {
        self.liveness.take();
        let mut clean = true;
        let response_deadline = time::Instant::now()
            + deadline
                .checked_duration_since(time::Instant::now())
                .unwrap_or_default()
                .min(WATCHDOG_RESPONSE_TIMEOUT);
        let status = match response_deadline.checked_duration_since(time::Instant::now()) {
            Some(remaining) if !remaining.is_zero() => {
                time::timeout(remaining, self.child.wait()).await.ok()
            }
            _ => None,
        };
        let status = match status {
            Some(Ok(status)) => Some(status),
            _ => {
                clean = false;
                direct_kill_process_group(self.process_group)?;
                let remaining = deadline
                    .checked_duration_since(time::Instant::now())
                    .filter(|remaining| !remaining.is_zero())
                    .ok_or(())?;
                Some(
                    time::timeout(remaining, self.child.wait())
                        .await
                        .map_err(|_| ())?
                        .map_err(|_| ())?,
                )
            }
        };
        if status.and_then(|status| status.signal()) != Some(libc::SIGKILL) {
            clean = false;
        }
        // The health pipe may have closed because the watchdog itself failed before observing
        // liveness EOF. The still-live owner therefore repeats the exact-PGID force operation;
        // ESRCH is success here and the caller separately waits/reaps Host before proving empty.
        if direct_kill_process_group(self.process_group).is_err() {
            clean = false;
        }

        let remaining = deadline
            .checked_duration_since(time::Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .ok_or(())?;
        let health = time::timeout(remaining, self.health_events.recv())
            .await
            .map_err(|_| ())?;
        if health != Some(HealthEvent::Eof) {
            clean = false;
        }
        if let Some(mut task) = self.health_task.take() {
            let remaining = deadline
                .checked_duration_since(time::Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .ok_or(())?;
            if !matches!(time::timeout(remaining, &mut task).await, Ok(Ok(()))) {
                task.abort();
                let _ = task.await;
                clean = false;
            }
        }
        if clean { Ok(()) } else { Err(()) }
    }

    pub(crate) async fn verify_empty(&self, deadline: time::Instant) -> Result<(), ()> {
        wait_for_empty_process_group(self.process_group, deadline).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn production_command_is_an_exact_self_exec_private_mode() {
        let command = production_watchdog_command().expect("self executable watchdog command");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [PRIVATE_MODE_ARGUMENT]
        );
        assert_eq!(
            PathBuf::from(command.get_program()),
            env::current_exe().unwrap()
        );
    }
}
