#!/usr/bin/env python3
"""Shared GitHub helpers for skill install scripts."""

from __future__ import annotations

import os
import json
from pathlib import Path
import urllib.parse
import urllib.request


def default_skills_dir() -> str:
    """Use the owning Runtime's resource directory, even outside its process environment."""
    descriptor = Path(__file__).resolve().parent.parent / "runtime.json"
    if descriptor.is_file():
        agent_dir = json.loads(descriptor.read_text())["userResourceDir"]
    else:
        agent_dir = os.environ.get("PI_CODING_AGENT_DIR") or "~/.pi/agent"
    return os.path.join(os.path.abspath(os.path.expanduser(agent_dir)), "skills")


def github_request(url: str, user_agent: str) -> bytes:
    headers = {"User-Agent": user_agent}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"token {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def github_api_contents_url(repo: str, path: str, ref: str) -> str:
    return f"https://api.github.com/repos/{repo}/contents/{urllib.parse.quote(path, safe='/')}?{urllib.parse.urlencode({'ref': ref})}"
