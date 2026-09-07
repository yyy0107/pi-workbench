const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);

async function getSystemFontFamilies({ platform = process.platform, execute = run } = {}) {
  let command;
  let args;
  switch (platform) {
    case "linux":
      command = "fc-list";
      // Iterate family aliases instead of splitting on commas inside font names.
      args = ["--format", "%{[]family{%{family}\\n}}"];
      break;
    case "darwin":
      command = "/usr/bin/osascript";
      args = [
        "-l",
        "JavaScript",
        "-e",
        "ObjC.import('AppKit'); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join('\\n')",
      ];
      break;
    case "win32":
      command = "powershell.exe";
      args = [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
      ];
      break;
    default:
      throw new Error("System font enumeration is unavailable on this platform.");
  }
  const { stdout } = await execute(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return [
    ...new Set(
      stdout
        .split(/\r?\n/u)
        .map((family) => family.trim())
        .filter(Boolean),
    ),
  ];
}

module.exports = { getSystemFontFamilies };
