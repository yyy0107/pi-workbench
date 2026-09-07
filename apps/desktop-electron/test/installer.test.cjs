const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function findCompiler() {
  if (process.env.NSIS_MAKENSIS) return process.env.NSIS_MAKENSIS;
  const cache =
    process.env.ELECTRON_BUILDER_CACHE ||
    path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache");
  if (!fs.existsSync(cache)) return undefined;
  return fs
    .readdirSync(cache, { recursive: true })
    .filter((entry) => entry.endsWith("makensis.exe"))
    .map((entry) => path.join(cache, entry))[0];
}

test("NSIS clears only missing quoted uninstallers and preserves installation metadata", (t) => {
  if (process.platform !== "win32") return t.skip("Windows registry integration test");
  const compiler = findCompiler();
  if (!compiler) return t.skip("Set NSIS_MAKENSIS or populate electron-builder's NSIS cache");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-installer-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const builderRoot = path.dirname(
    require.resolve("app-builder-lib/package.json", {
      paths: [path.dirname(require.resolve("electron-builder/package.json"))],
    }),
  );
  const utility = fs.readFileSync(
    path.join(builderRoot, "templates/nsis/include/installUtil.nsh"),
    "utf8",
  );
  // Exercise the same parser provided by the installed builder, without running
  // its installation/uninstallation sections against the user's application.
  const parser = utility.match(/Function GetInQuotes\r?\n[\s\S]*?FunctionEnd/);
  assert.ok(parser, "electron-builder must provide GetInQuotes");
  const include = path.resolve(__dirname, "../resources/installer/installer.nsh");
  const executable = path.join(temp, "check.exe");
  const source = path.join(temp, "check.nsi");
  fs.writeFileSync(
    source,
    String.raw`
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${executable}"
!include LogicLib.nsh
!include "${include}"
!define TEST_KEY "Software\PiWorkbenchInstallerTests\${path.basename(temp)}"
${parser[0]}
!macro check COMMAND EXPECTED
  WriteRegStr HKCU "${"${TEST_KEY}"}" "UninstallString" '${"${COMMAND}"}'
  StrCpy $R0 "preserved-r0"
  StrCpy $R1 "preserved-r1"
  !insertmacro clearMissingWorkbenchUninstaller HKCU "${"${TEST_KEY}"}"
  StrCmp $R0 "preserved-r0" +2
    Goto failed
  StrCmp $R1 "preserved-r1" +2
    Goto failed
  ReadRegStr $0 HKCU "${"${TEST_KEY}"}" "UninstallString"
  StrCmp $0 '${"${EXPECTED}"}' +2
    Goto failed
!macroend
Section
  WriteRegStr HKCU "${"${TEST_KEY}"}" "InstallLocation" "retain-location"
  !insertmacro check '$\"$EXEDIR\missing uninstaller.exe$\" /currentuser' ""
  !insertmacro check '$\"$EXEPATH$\" /currentuser' '$\"$EXEPATH$\" /currentuser'
  !insertmacro check "" ""
  !insertmacro check "unquoted-command /S" "unquoted-command /S"
  !insertmacro check '$\"unterminated' '$\"unterminated'
  ReadRegStr $0 HKCU "${"${TEST_KEY}"}" "InstallLocation"
  StrCmp $0 "retain-location" +2
    Goto failed
  DeleteRegKey HKCU "${"${TEST_KEY}"}"
  SetErrorLevel 0
  Quit
failed:
  DeleteRegKey HKCU "${"${TEST_KEY}"}"
  SetErrorLevel 1
SectionEnd
`,
  );
  const compiled = spawnSync(compiler, ["/V2", source], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const checked = spawnSync(executable, [], { encoding: "utf8", timeout: 30_000 });
  assert.equal(checked.status, 0, checked.error?.message || checked.stdout + checked.stderr);
});
