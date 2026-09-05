import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { releaseUpdateInfo } from "./release-update-info.mjs";

test("update manifests reference the exact published binary and checksum for each architecture", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const platform of ["win32", "darwin", "linux"])
    for (const arch of ["x64", "arm64"]) {
      const targetKey = `${platform}-${arch}${platform === "linux" ? "-glibc" : ""}`;
      const filename = `${targetKey}-Pi-Workbench${platform === "win32" ? ".exe" : platform === "darwin" ? ".zip" : ".deb"}`;
      writeFileSync(path.join(directory, filename), targetKey);
      const result = releaseUpdateInfo({
        targetKey,
        version: "0.2.0-beta.1",
        directory,
        packages: [{ filename }],
      });
      const info = JSON.parse(result.content);
      assert.equal(result.filename, `latest-${targetKey}.yml`);
      assert.equal(info.version, "0.2.0-beta.1");
      assert.deepEqual(info.files, [
        {
          url: filename,
          sha512: createHash("sha512").update(targetKey).digest("base64"),
          size: targetKey.length,
        },
      ]);
    }
});
