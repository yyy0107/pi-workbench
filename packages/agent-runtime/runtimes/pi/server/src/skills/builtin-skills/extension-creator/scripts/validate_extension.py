#!/usr/bin/env python3
"""Check a scaffold's structure; --load also executes its factory with the recorded Pi SDK."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from create_extension import normalize_name


# Pi owns TypeScript loading. This probe uses its public API, not a regex-based TS validator.
LOAD_PROBE = '''
const [sdk, entry, temporary] = process.argv.slice(1);
const { discoverAndLoadExtensions } = await import(sdk);
const result = await discoverAndLoadExtensions([entry], temporary, temporary);
if (result.errors.length) throw new Error(result.errors.map(e => e.error).join("\\n"));
if (result.extensions.length !== 1) throw new Error("Expected exactly one loaded extension.");
const extension = result.extensions[0];
console.log(JSON.stringify({
  tools: [...extension.tools.keys()],
  commands: [...extension.commands.keys()],
  events: [...extension.handlers.keys()],
}));
process.exit(0);
'''


def validate_structure(target):
    target = Path(target).expanduser()
    entry = target / "index.ts" if target.is_dir() else target
    if entry.is_symlink() or not entry.is_file() or entry.suffix not in (".ts", ".js"):
        raise ValueError("Expected a regular .ts/.js entry file or a directory containing index.ts.")
    if not entry.read_text(encoding="utf-8").strip():
        raise ValueError("The extension entry is empty.")
    manifest_path = entry.parent / "package.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("package.json must contain an object.")
        # A dependency-only package.json is valid for standalone extensions.
        if "pi" in manifest:
            pi = manifest["pi"]
            if not isinstance(pi, dict) or pi.get("extensions") != [f"./{entry.name}"]:
                raise ValueError("This scaffold check expects pi.extensions to reference only the selected entry.")
            name = manifest.get("name")
            if not isinstance(name, str) or normalize_name(name) != name:
                raise ValueError("The generated package name must be lowercase hyphen-case.")
            if not isinstance(manifest.get("version"), str) or not manifest["version"].strip():
                raise ValueError("The generated package requires a version string.")
    return entry.resolve()


def load_extension(entry, runtime_path):
    runtime = json.loads(Path(runtime_path).read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="pi-extension-check-") as temporary:
        result = subprocess.run(
            [runtime["nodeExecutable"], "--input-type=module", "--eval", LOAD_PROBE,
             runtime["piCodingAgentModule"], str(entry), temporary],
            cwd=temporary, env={**os.environ, "PI_CODING_AGENT_DIR": temporary},
            text=True, capture_output=True, timeout=30,
        )
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Pi extension loading failed.")
    return result.stdout.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--load", action="store_true", help="Execute the reviewed extension factory; not a sandbox")
    parser.add_argument("--runtime", default=str(Path(__file__).resolve().parent.parent / "runtime.json"),
                        help="Runtime descriptor (defaults to this installed skill's runtime.json)")
    args = parser.parse_args(argv)
    try:
        entry = validate_structure(args.path)
        if args.load:
            print(f"Pi SDK load passed: {load_extension(entry, args.runtime)}")
        else:
            print(f"Structure passed (TypeScript and behavior not checked): {entry}")
        return 0
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
