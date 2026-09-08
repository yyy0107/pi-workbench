"""Run with python3 -B test/skills/test_extension_creator.py from the server package."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.dont_write_bytecode = True
server = Path(__file__).resolve().parents[2]
scripts = server / "src/internal-skills/extension-creator/scripts"
sys.path.insert(0, str(scripts))
import create_extension as creator
import validate_extension as validator


BEHAVIOR_PROBE = '''
import assert from "node:assert/strict";
const [sdk, temporary, commandFile, toolFile, eventFile] = process.argv.slice(1);
const { discoverAndLoadExtensions } = await import(sdk);
const result = await discoverAndLoadExtensions([commandFile, toolFile, eventFile], temporary, temporary);
assert.deepEqual(result.errors, []);
const [command, tool, event] = result.extensions;
const sent = [];
result.runtime.sendMessage = (...args) => sent.push(args);
await command.commands.get("command-local").handler("  hello  ", {});
assert.equal(sent[0][0].content, "hello");
assert.equal(sent[0][1].triggerTurn, false);
await command.commands.get("command-local").handler("", {});
assert.equal(sent[1][0].content, "Command Local is ready.");
const echo = tool.tools.get("tool_local").definition;
assert.deepEqual(await echo.execute("test", { text: "hello" }), {
  content: [{ type: "text", text: "hello" }], details: {},
});
const notices = [];
const handler = event.handlers.get("session_start")[0];
await handler({}, { hasUI: false });
await handler({}, { hasUI: true, ui: { notify: (...args) => notices.push(args) } });
assert.deepEqual(notices, [["Event Local is ready.", "info"]]);
console.log("Generated command, tool, and event behavior passed.");
'''


def rejects(action, errors=(ValueError, OSError)):
    try:
        action()
    except errors:
        return
    raise AssertionError("Expected invalid input to fail")


def check():
    assert creator.normalize_name(" My__Extension!! ") == "my-extension"
    rejects(lambda: creator.normalize_name("../"))
    rejects(lambda: creator.normalize_name("x" * 65))
    runtime = json.loads(subprocess.check_output([
        "node", "--input-type=module", "--eval",
        'console.log(JSON.stringify({nodeExecutable:process.execPath,piCodingAgentModule:import.meta.resolve("@earendil-works/pi-coding-agent")}))',
    ], cwd=server, text=True))
    with tempfile.TemporaryDirectory(prefix="extension-creator-test-") as temporary:
        root = Path(temporary)
        runtime["userResourceDir"] = str(root / "agent")
        runtime_path = root / "runtime.json"
        runtime_path.write_text(json.dumps(runtime))
        with patch.object(creator, "__file__", str(root / "scripts/create_extension.py")), patch.dict(
            os.environ, {"PI_CODING_AGENT_DIR": str(root / "other-agent")}
        ):
            assert creator.user_extension_parent() == root / "agent/extensions"
        entries = {}
        for kind in creator.TEMPLATES:
            for package in (False, True):
                name = f"{kind}-{'package' if package else 'local'}"
                created = creator.create_extension(name, root, kind, package)
                entry = validator.validate_structure(created)
                registered = json.loads(validator.load_extension(entry, runtime_path))
                expected_key = {"command": "commands", "tool": "tools", "event": "events"}[kind]
                expected_id = "session_start" if kind == "event" else name.replace("-", "_") if kind == "tool" else name
                assert registered[expected_key] == [expected_id]
                if not package:
                    assert list(created.iterdir()) == [entry]
                    entries[kind] = entry
                else:
                    manifest = json.loads((created / "package.json").read_text())
                    assert manifest["private"] is True
                    assert manifest["pi"]["extensions"] == ["./index.ts"]
                original = entry.read_text()
                rejects(lambda: creator.create_extension(name, root, kind, package))
                assert entry.read_text() == original

        subprocess.run([
            runtime["nodeExecutable"], "--input-type=module", "--eval", BEHAVIOR_PROBE,
            runtime["piCodingAgentModule"], temporary,
            str(entries["command"]), str(entries["tool"]), str(entries["event"]),
        ], cwd=temporary, env={**os.environ, "PI_CODING_AGENT_DIR": temporary}, check=True, timeout=30)
        rejects(lambda: creator.create_extension("blocked", root / ".builtin"))
        dangling = root / "symlink-target"
        dangling.symlink_to(root / "missing", target_is_directory=True)
        rejects(lambda: creator.create_extension("symlink-target", root))
        bad = root / "invalid.ts"
        bad.write_text("export default function ( {")
        assert validator.validate_structure(bad) == bad
        rejects(lambda: validator.load_extension(bad, runtime_path))
        bad.write_text('throw new Error("factory failed");\nexport default () => {};')
        rejects(lambda: validator.load_extension(bad, runtime_path))
        (root / "tool-package/package.json").write_text('{"pi":{"extensions":["../escape.ts"]}}')
        rejects(lambda: validator.validate_structure(root / "tool-package"))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            assert creator.main(["bad", "--package", "--user"]) == 1
            assert creator.main(["cli", "--path", temporary]) == 0
            assert validator.main([str(root / "cli"), "--load", "--runtime", str(runtime_path)]) == 0
    print("Extension creator checks passed: six scaffolds, SDK loading, behavior, scope, no overwrite, and failures.")


if __name__ == "__main__":
    check()
