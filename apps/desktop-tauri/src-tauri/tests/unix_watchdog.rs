#![cfg(unix)]

use std::{
    io::{BufRead as _, BufReader, Read as _},
    os::unix::process::{CommandExt as _, ExitStatusExt as _},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const PRIVATE_MODE_ARGUMENT: &str = "--workbench-runtime-watchdog-v1";
const READY_PREFIX: &str = "WORKBENCH_RUNTIME_WATCHDOG_READY_V1 ";

struct ChildGuard(Child);

impl ChildGuard {
    fn child_mut(&mut self) -> &mut Child {
        &mut self.0
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn private_watchdog_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_workbench-desktop-tauri"));
    command
        .env_clear()
        .arg(PRIVATE_MODE_ARGUMENT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn sleep_in_process_group(process_group: i32) -> ChildGuard {
    let mut command = Command::new("/bin/sleep");
    command.arg("30").process_group(process_group);
    ChildGuard(command.spawn().expect("spawn process-group member"))
}

fn wait_for_exit(child: &mut Child, label: &str) -> std::process::ExitStatus {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => panic!("{label} did not exit"),
            Err(error) => panic!("failed to inspect {label}: {error}"),
        }
    }
}

#[test]
fn private_mode_rejects_a_non_leader_without_signaling_its_group() {
    let mut decoy = sleep_in_process_group(0);
    let decoy_pid = decoy.child_mut().id();
    assert!(decoy_pid > 1);

    let mut candidate = private_watchdog_command();
    candidate
        .stdin(Stdio::null())
        .process_group(i32::try_from(decoy_pid).expect("decoy PID fits pid_t"));
    let output = candidate.output().expect("run non-leader private mode");
    assert_eq!(output.status.code(), Some(65));
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
    assert!(
        matches!(decoy.child_mut().try_wait(), Ok(None)),
        "non-leader invocation signaled the unrelated group leader"
    );
}

#[test]
fn liveness_eof_kills_only_the_verified_exact_process_group() {
    let mut decoy = sleep_in_process_group(0);
    let decoy_pid = decoy.child_mut().id();

    let mut command = private_watchdog_command();
    command.process_group(0);
    let mut watchdog = ChildGuard(command.spawn().expect("spawn real private watchdog mode"));
    let watchdog_pid = watchdog.child_mut().id();
    assert!(watchdog_pid > 1);

    let stdout = watchdog
        .child_mut()
        .stdout
        .take()
        .expect("watchdog health stdout");
    let (ready_sender, ready_receiver) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line);
        let _ = ready_sender.send((result, line, reader.into_inner()));
    });
    let (ready_result, ready, mut health) = ready_receiver
        .recv_timeout(Duration::from_secs(3))
        .expect("watchdog readiness deadline");
    assert_eq!(ready_result.expect("read watchdog readiness"), ready.len());
    assert_eq!(ready, format!("{READY_PREFIX}{watchdog_pid}\n"));

    #[cfg(target_os = "linux")]
    assert!(
        std::fs::read(format!("/proc/{watchdog_pid}/environ"))
            .expect("read watchdog environment")
            .is_empty(),
        "private watchdog inherited an environment"
    );

    // SAFETY: getpgid only inspects the live child PID.
    assert_eq!(
        unsafe { libc::getpgid(watchdog_pid as i32) },
        watchdog_pid as i32
    );
    let mut member = sleep_in_process_group(watchdog_pid as i32);
    let member_pid = member.child_mut().id();
    // SAFETY: getpgid only inspects the live child PID.
    assert_eq!(
        unsafe { libc::getpgid(member_pid as i32) },
        watchdog_pid as i32
    );

    drop(watchdog.child_mut().stdin.take());
    let watchdog_status = wait_for_exit(watchdog.child_mut(), "watchdog");
    let member_status = wait_for_exit(member.child_mut(), "exact process-group member");
    assert_eq!(watchdog_status.signal(), Some(libc::SIGKILL));
    assert_eq!(member_status.signal(), Some(libc::SIGKILL));
    assert!(
        matches!(decoy.child_mut().try_wait(), Ok(None)),
        "exact-PGID cleanup signaled the unrelated decoy {decoy_pid}"
    );

    let mut trailing_health = Vec::new();
    health
        .read_to_end(&mut trailing_health)
        .expect("watchdog health EOF");
    assert!(trailing_health.is_empty(), "watchdog emitted extra output");
}
