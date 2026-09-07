"""Offline check: python3 -B test/skills/test_skill_installer.py (from the server package)."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch
import zipfile

sys.dont_write_bytecode = True
scripts = Path(__file__).resolve().parents[2] / "src/skills/builtin-skills/skill-installer/scripts"
sys.path.insert(0, str(scripts))
import github_utils


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, scripts / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


installer = load_script("install-skill-from-github")
listing = load_script("list-skills")


def rejects(action):
    try:
        action()
    except installer.InstallError:
        return
    raise AssertionError("Expected unsafe input to be rejected")


def check():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        descriptor = root / "bundled/runtime.json"
        descriptor.parent.mkdir()
        with patch.object(github_utils, "__file__", str(root / "bundled/scripts/github_utils.py")), patch.dict(
            os.environ, {"PI_CODING_AGENT_DIR": str(root / "pi"), "CODEX_HOME": str(root / "codex")}
        ):
            assert github_utils.default_skills_dir() == str(root / "pi/skills")
            descriptor.write_text(json.dumps({"userResourceDir": str(root / "runtime")}))
            assert github_utils.default_skills_dir() == str(root / "runtime/skills")

        repo = root / "repo"
        skill = repo / "example"
        skill.mkdir(parents=True)
        content = "---\nname: example\ndescription: Example skill.\n---\n\n# Example\n"
        (skill / "SKILL.md").write_text(content)
        (skill / "references").mkdir()
        (skill / "references/guide.md").write_text("Supporting guide\n")
        destination = root / "project/.pi/skills"
        args = ["--repo", "owner/repo", "--path", "example", "--dest", str(destination)]
        with patch.object(installer, "_prepare_repo", return_value=str(repo)), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            assert installer.main(args) == 0
            assert (destination / "example/SKILL.md").read_text() == content
            assert (destination / "example/references/guide.md").read_text() == "Supporting guide\n"
            (destination / "example/SKILL.md").write_text("User customization\n")
            assert installer.main(args) == 1
            assert (destination / "example/SKILL.md").read_text() == "User customization\n"
            assert installer.main(["--repo", "owner/repo", "--path", "../outside", "--dest", str(destination)]) == 1
            assert installer.main(args[:-1] + [str(destination / ".builtin")]) == 1
            assert not (destination / ".builtin").exists()
        assert not (root / "codex").exists()

        outside = root / "secret.txt"
        outside.write_text("Private\n")
        (skill / "escape").symlink_to(outside)
        rejects(lambda: installer._validate_skill(str(skill), str(repo)))
        (skill / "escape").unlink()
        archive_bytes = io.BytesIO()
        with zipfile.ZipFile(archive_bytes, "w") as archive:
            archive.writestr("../escape.txt", "Unsafe\n")
        archive_bytes.seek(0)
        with zipfile.ZipFile(archive_bytes) as archive:
            rejects(lambda: installer._safe_extract_zip(archive, str(root / "unpack")))
        assert not (root / "escape.txt").exists()

        builtin = destination / ".builtin/skill-installer"
        builtin.mkdir(parents=True)
        (builtin / "SKILL.md").write_text("Built-in instructions\n")
        assert listing._installed_skills(str(destination)) == {"example", "skill-installer"}
        assert listing._parse_args([]).repo == "badlogic/pi-skills"
        assert listing._parse_args(["--dest", str(destination)]).dest == str(destination)
        response = json.dumps([
            {"name": "example", "type": "dir"},
            {"name": ".github", "type": "dir"},
            {"name": "README.md", "type": "file"},
        ]).encode()
        with patch.object(listing, "_request", return_value=response):
            assert listing._list_skills("owner/repo", "skills", "main") == ["example"]
        assert github_utils.github_api_contents_url("owner/repo", "skills/a b", "feature/docs") == "https://api.github.com/repos/owner/repo/contents/skills/a%20b?ref=feature%2Fdocs"
    print("Skill installer checks passed: Pi scope, copying, no overwrite, path/link/archive boundaries, and listing.")


if __name__ == "__main__":
    check()
