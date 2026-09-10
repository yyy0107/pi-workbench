const assert = require("node:assert/strict");
const test = require("node:test");
const { applyDesktopMotionPreference } = require("../src/desktop-services.cjs");

test("KDE motion overrides stale GTK preferences while preserving opt-outs and fallbacks", () => {
  const reduce = "force-prefers-reduced-motion";
  const animate = "force-prefers-no-reduced-motion";
  function check(value, expected, options = {}, existing = []) {
    const switches = new Set(existing);
    const calls = [];
    applyDesktopMotionPreference(
      {
        commandLine: {
          hasSwitch: (key) => switches.has(key),
          appendSwitch: (key) => switches.add(key),
        },
      },
      {
        platform: "linux",
        environment: { XDG_CURRENT_DESKTOP: "KDE", KDE_SESSION_VERSION: "6" },
        execute: (command, args, limits) => {
          calls.push(command);
          assert.deepEqual(args, [
            "--file",
            "kdeglobals",
            "--group",
            "KDE",
            "--key",
            "AnimationDurationFactor",
          ]);
          assert.equal(limits.timeout, 1000);
          assert.equal(limits.maxBuffer, 1024);
          assert.equal(limits.encoding, "utf8");
          if (value instanceof Error) throw value;
          return value;
        },
        ...options,
      },
    );
    assert.deepEqual([...switches], expected);
    return calls;
  }
  for (const factor of ["0.25\n", "1", "2", " 0.5 "]) check(factor, [animate]);
  check("0\n", [reduce]);
  for (const invalid of ["", "\n", "invalid", "-1", "Infinity", "NaN"]) check(invalid, []);
  assert.deepEqual(check("1", [], { platform: "darwin" }), []);
  assert.deepEqual(check("1", [], { environment: { XDG_CURRENT_DESKTOP: "GNOME" } }), []);
  assert.deepEqual(check("1", [], { environment: {} }), []);
  check("1", [animate], { environment: { XDG_CURRENT_DESKTOP: "ubuntu:KDE" } });
  for (const flag of [reduce, animate]) {
    assert.deepEqual(check("0.25", [flag], {}, [flag]), []);
  }
  assert.deepEqual(check("1", [animate]), ["kreadconfig6"]);
  assert.deepEqual(
    check("1", [animate], {
      environment: { XDG_CURRENT_DESKTOP: "KDE", KDE_SESSION_VERSION: "5" },
    }),
    ["kreadconfig5"],
  );
  assert.deepEqual(check(Object.assign(new Error("missing"), { code: "ENOENT" }), []), [
    "kreadconfig6",
    "kreadconfig5",
  ]);
  for (const code of ["ETIMEDOUT", "EACCES", "ENOBUFS"]) {
    assert.deepEqual(check(Object.assign(new Error("unavailable"), { code }), []), [
      "kreadconfig6",
    ]);
  }
  const commands = [];
  check("unused", [reduce], {
    execute: (command) => {
      commands.push(command);
      if (command === "kreadconfig6") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return "0";
    },
  });
  assert.deepEqual(commands, ["kreadconfig6", "kreadconfig5"]);
});
