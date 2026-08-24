import assert from "node:assert/strict";
import test from "node:test";

import { BashCommandPolicy } from "./bash-command-policy";

const policy = new BashCommandPolicy();

test("rewrites temporary output capture followed by exit status and tail readback", () => {
  const command =
    'npx skills add https://github.com/NetEase/skills > /tmp/skills_add.log 2>&1; echo "exit=$?"; tail -40 /tmp/skills_add.log';

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("rewrites exact temporary log readback joined with and", () => {
  assert.deepEqual(policy.normalize("foo >/tmp/foo.log 2>&1 && cat /tmp/foo.log"), {
    action: "rewrite",
    originalCommand: "foo >/tmp/foo.log 2>&1 && cat /tmp/foo.log",
    command: "foo",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("rewrites quoted temporary paths and finite head readback", () => {
  const command = '工具 > "/tmp/tool output.log" 2>&1\necho $?\nhead -n 40 "/tmp/tool output.log"';
  const result = policy.normalize(command);

  assert.equal(result.action, "rewrite");
  assert.equal(result.command, "工具");
});

test("rewrites tee-only temporary capture and removes stderr pipe redirection", () => {
  assert.deepEqual(policy.normalize("foo 2>&1 | tee /tmp/foo.log"), {
    action: "rewrite",
    originalCommand: "foo 2>&1 | tee /tmp/foo.log",
    command: "foo",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("allows redirects with business semantics or no exact readback", () => {
  const commands = [
    "echo hello > config.txt",
    "pnpm build > build.log",
    "pnpm build > /tmp/build.log",
    "foo >> /tmp/foo.log 2>&1; cat /tmp/foo.log",
    "foo </tmp/input > /tmp/foo.log 2>&1; cat /tmp/foo.log",
    "foo > /tmp/foo.log 2>&1; cat /tmp/other.log",
    "foo > /tmp/foo.log 2>&1 && tail -f /tmp/foo.log",
    "foo > /tmp/foo.log 2>&1; cat /tmp/foo.log; rm /tmp/foo.log",
    "consume /tmp/foo.log > /tmp/foo.log 2>&1; cat /tmp/foo.log",
    "foo 2>&1 | tee --append /tmp/foo.log",
  ];

  for (const command of commands) {
    assert.deepEqual(policy.normalize(command), {
      action: "allow",
      originalCommand: command,
      command,
      executionMode: "pty",
    });
  }
});

test("allows malformed or oversized commands instead of guessing", () => {
  const malformed = "foo > /tmp/foo.log 2>&1; cat '";
  const oversized = "x".repeat(64 * 1024 + 1);

  assert.equal(policy.normalize(malformed).action, "allow");
  assert.equal(policy.normalize(oversized).action, "allow");
});

test("lifts timeout and removes a finite observation pipeline with exit readback", () => {
  const command =
    'timeout 60 npx skills add https://github.com/NetEase/skills 2>&1 | head -50; echo "EXIT: $?"';

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    timeoutSeconds: 60,
    reason: "PTY already captures command output",
  });
});

test("unwraps a detached script recorder so the primary command stays on the owned PTY", () => {
  const command =
    'script -q -c "timeout 180 npx -y skills add https://github.com/NetEase/skills" /tmp/skills_run.log >/dev/null 2>&1 & pid=$!; sleep 5; tail -80 /tmp/skills_run.log; wait $pid';

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx -y skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    timeoutSeconds: 180,
    reason: "PTY already captures command output",
  });
});

test("unwraps a setsid script recorder surrounded by process-observation scaffolding", () => {
  const command = `pkill -f "skills add" 2>/dev/null; pkill -f "script -q -c timeout 180 npx" 2>/dev/null; sleep 1
rm -f /tmp/skills_run2.log
setsid script -q -c "npx -y skills add https://github.com/NetEase/skills" /tmp/skills_run2.log >/dev/null 2>&1 & echo "launched pid $!"; sleep 3; ps aux | grep -v grep | grep -E "skills add" | awk '{print $2, $11, $12, $13, $14, $15}'`;

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx -y skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("unwraps a detached tmux recorder whose surrounding commands only inspect it", () => {
  const command =
    `tmux new-session -d -s skills-install 'npx skills add https://github.com/NetEase/skills; ` +
    `echo "[DONE-EXIT:$?]"; sleep 2'; sleep 3; tmux ls`;

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("unwraps tmux cleanup, status, and filtered capture-pane observation", () => {
  const command =
    'tmux kill-session -t skills 2>/dev/null; tmux new-session -d -s skills "npx -y skills add https://github.com/NetEase/skills"; echo "tmux session started"; sleep 3; tmux capture-pane -t skills -p | grep -v \'^\\s*$\' | tail -15';

  assert.deepEqual(policy.normalize(command), {
    action: "rewrite",
    originalCommand: command,
    command: "npx -y skills add https://github.com/NetEase/skills",
    executionMode: "pty",
    reason: "PTY already captures command output",
  });
});

test("preserves pipelines and script commands that have independent business semantics", () => {
  const commands = [
    "git log --oneline | head -20",
    "pnpm build 2>&1 | head -50",
    'script -q -c "bash" /tmp/session.log',
    'script -q -c "job" /tmp/job.log >/dev/null 2>&1 & publish /tmp/job.log',
    'setsid script -q -c "job" /tmp/job.log >/dev/null 2>&1 & echo "service started"',
    'rm -f /tmp/job.log; setsid script -q -c "job" /tmp/job.log >/dev/null 2>&1 & deploy production',
    "tmux new-session -d -s server 'pnpm dev'",
    "tmux new-session -d -s deploy 'deploy production'; notify release",
    "tmux new-session -d -s server 'pnpm dev'; sleep 3",
  ];

  for (const command of commands) {
    assert.deepEqual(policy.normalize(command), {
      action: "allow",
      originalCommand: command,
      command,
      executionMode: "pty",
    });
  }
});
