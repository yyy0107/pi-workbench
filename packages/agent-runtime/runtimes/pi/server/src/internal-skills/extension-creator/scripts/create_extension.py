#!/usr/bin/env python3
"""Create a Pi extension or a local Pi package using only Python's standard library."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
from string import Template
import sys


TEMPLATES = {
    "command": '''import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand($name, {
    description: $description,
    handler: async (args) => {
      pi.sendMessage({
        customType: $name,
        content: args.trim() || $ready,
        display: true,
      }, { triggerTurn: false });
    },
  });
}
''',
    "tool": '''import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: $tool_name,
    label: $title,
    description: $description,
    parameters: Type.Object({
      text: Type.String({ description: "Text to echo." }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: params.text }],
        details: {},
      };
    },
  });
}
''',
    "event": '''import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify($ready, "info");
  });
}
''',
}


def normalize_name(value):
    name = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not name or len(name) > 64:
        raise ValueError("Name must normalize to 1–64 lowercase letters, digits, and hyphens.")
    return name


def user_extension_parent():
    descriptor = Path(__file__).resolve().parent.parent / "runtime.json"
    agent_dir = (
        json.loads(descriptor.read_text(encoding="utf-8"))["userResourceDir"]
        if descriptor.is_file()
        else os.environ.get("PI_CODING_AGENT_DIR") or "~/.pi/agent"
    )
    return Path(agent_dir).expanduser().resolve() / "extensions"


def create_extension(raw_name, parent, kind="command", package=False, description=None):
    name = normalize_name(raw_name)
    if kind not in TEMPLATES:
        raise ValueError(f"Unknown extension kind: {kind}")
    parent = Path(parent).expanduser().resolve()
    if any(part.casefold() == ".builtin" for part in parent.parts):
        raise ValueError("Built-in resources are application-owned; choose another directory.")
    title = name.replace("-", " ").title()
    description = description or {
        "command": f"Echo command arguments with {title}.",
        "tool": f"Echo text with {title}.",
        "event": f"Show {title} readiness when a session starts.",
    }[kind]
    code = Template(TEMPLATES[kind]).substitute({
        key: json.dumps(value, ensure_ascii=True)
        for key, value in {
            "name": name, "tool_name": name.replace("-", "_"), "title": title,
            "description": description, "ready": f"{title} is ready.",
        }.items()
    })
    destination = parent / name
    parent.mkdir(parents=True, exist_ok=True)
    # Reserve a new directory; existing files and dangling symlinks both fail without overwriting.
    destination.mkdir()
    try:
        (destination / "index.ts").write_text(code, encoding="utf-8")
        if package:
            peers = {"@earendil-works/pi-coding-agent": "*"}
            if kind == "tool":
                peers["typebox"] = "*"
            manifest = {
                "name": name, "version": "0.1.0", "private": True,
                "description": description, "type": "module", "keywords": ["pi-package"],
                "pi": {"extensions": ["./index.ts"]}, "peerDependencies": peers,
            }
            (destination / "package.json").write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
    except BaseException:
        shutil.rmtree(destination)
        raise
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--path", help="Parent directory; the normalized name is appended")
    scope.add_argument("--user", action="store_true", help="Use this Runtime's user extensions directory")
    parser.add_argument("--kind", choices=TEMPLATES, default="command")
    parser.add_argument("--package", action="store_true", help="Add a local Pi package manifest")
    parser.add_argument("--description")
    args = parser.parse_args(argv)
    try:
        if args.package and args.user:
            raise ValueError("For packages use --path, then install into the chosen Pi scope.")
        parent = args.path or (
            user_extension_parent() if args.user
            else Path.cwd() / ("pi-packages" if args.package else ".pi/extensions")
        )
        created = create_extension(args.name, parent, args.kind, args.package, args.description)
        print(f"Created {args.kind} extension: {created}")
        return 0
    except (OSError, ValueError, KeyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
