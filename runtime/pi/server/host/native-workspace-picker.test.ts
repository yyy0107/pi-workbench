import assert from "node:assert/strict";
import test from "node:test";

const { NativeWorkspacePickerUnavailableError, pickNativeWorkspaceDirectory } = (await import(
  new URL("./native-workspace-picker.ts", import.meta.url).href
)) as typeof import("./native-workspace-picker");

type NativeWorkspacePickerRunner = import("./native-workspace-picker").NativeWorkspacePickerRunner;

function failure(code: string | number, stderr = ""): Error {
  return Object.assign(new Error(`command failed: ${String(code)}`), { code, stderr });
}

const signal = () => new AbortController().signal;

test("uses the macOS folder chooser and maps user cancellation", async () => {
  const selected: NativeWorkspacePickerRunner = async () => ({
    stdout: "/Users/test/project/\n",
    stderr: "",
  });
  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "darwin", run: selected }),
    "/Users/test/project/",
  );

  const cancelled: NativeWorkspacePickerRunner = async () => {
    throw failure(1, "execution error: User canceled. (-128)");
  };
  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "darwin", run: cancelled }),
    undefined,
  );
});

test("uses the Windows folder browser and maps an empty result to cancellation", async () => {
  const selected: NativeWorkspacePickerRunner = async (command, args) => {
    assert.equal(command, "powershell.exe");
    assert.ok(args.includes("-STA"));
    return { stdout: "C:\\work\\selected\r\n", stderr: "" };
  };
  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "win32", run: selected }),
    "C:\\work\\selected",
  );

  const cancelled: NativeWorkspacePickerRunner = async () => ({ stdout: "", stderr: "" });
  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "win32", run: cancelled }),
    undefined,
  );
});

test("uses Zenity for a native Linux directory selection", async () => {
  const calls: string[] = [];
  const run: NativeWorkspacePickerRunner = async (command) => {
    calls.push(command);
    return { stdout: "/home/test/project\n", stderr: "" };
  };

  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "linux", run }),
    "/home/test/project",
  );
  assert.deepEqual(calls, ["zenity"]);
});

test("falls back to KDialog only when Zenity is not installed", async () => {
  const calls: string[] = [];
  const run: NativeWorkspacePickerRunner = async (command) => {
    calls.push(command);
    if (command === "zenity") throw failure("ENOENT");
    return { stdout: "/home/test/project\n", stderr: "" };
  };

  assert.equal(
    await pickNativeWorkspaceDirectory(signal(), { platform: "linux", run }),
    "/home/test/project",
  );
  assert.deepEqual(calls, ["zenity", "kdialog"]);
});

test("falls back to Yad when Zenity and KDialog are not installed", async () => {
  const calls: string[] = [];
  const selected = await pickNativeWorkspaceDirectory(new AbortController().signal, {
    platform: "linux",
    run: async (command) => {
      calls.push(command);
      if (command !== "yad") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { stdout: "/workspace/yad\n", stderr: "" };
    },
  });
  assert.equal(selected, "/workspace/yad");
  assert.deepEqual(calls, ["zenity", "kdialog", "yad"]);
});

test("treats cancellation as final instead of opening another picker", async () => {
  const calls: string[] = [];
  const run: NativeWorkspacePickerRunner = async (command) => {
    calls.push(command);
    throw failure(1);
  };

  assert.equal(await pickNativeWorkspaceDirectory(signal(), { platform: "linux", run }), undefined);
  assert.deepEqual(calls, ["zenity"]);
});

test("surfaces a real Zenity failure without masking it with a fallback", async () => {
  const calls: string[] = [];
  const expected = failure(2, "display unavailable");
  const run: NativeWorkspacePickerRunner = async (command) => {
    calls.push(command);
    throw expected;
  };

  await assert.rejects(
    pickNativeWorkspaceDirectory(signal(), { platform: "linux", run }),
    (error) => error === expected,
  );
  assert.deepEqual(calls, ["zenity"]);
});

test("does not turn a caller abort into cancellation or fallback", async () => {
  const abort = new AbortController();
  abort.abort(new Error("request closed"));
  const calls: string[] = [];
  const expected = failure("ABORT_ERR");
  const run: NativeWorkspacePickerRunner = async (command) => {
    calls.push(command);
    throw expected;
  };

  await assert.rejects(
    pickNativeWorkspaceDirectory(abort.signal, { platform: "linux", run }),
    (error) => error === expected,
  );
  assert.deepEqual(calls, ["zenity"]);
});

test("reports that no native picker is available when Linux tools are absent", async () => {
  const run: NativeWorkspacePickerRunner = async () => {
    throw failure("ENOENT");
  };

  await assert.rejects(
    pickNativeWorkspaceDirectory(signal(), { platform: "linux", run }),
    (error) => error instanceof NativeWorkspacePickerUnavailableError,
  );
});
