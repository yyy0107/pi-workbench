import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalFileService } from "../src/local-files";
import { createLocalFileContentHandler } from "../src/http";
import { createLocalFileRpcRoutes } from "../src/file-rpc-routes";
import { WorkspaceFileError } from "../src/files";
import { rpcBusinessError } from "@workbench/host-server/rpc";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-local-file-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, service: new LocalFileService() };
}

test("local files reuse text validation, canonical paths and version-checked saves without a project", async (t) => {
  const { directory, service } = await fixture(t);
  const target = path.join(directory, "notes.md");
  await writeFile(target, "original 文本");
  const alias = path.join(directory, "alias.md");
  await symlink(target, alias);
  const descriptor = await service.describeFile(alias);
  assert.equal(descriptor.absolutePath, target);
  assert.equal(descriptor.encoding, "utf-8");
  const snapshot = await service.readFile(target);
  const saved = await service.writeFile(alias, "updated", snapshot.version);
  assert.equal(saved.content, "updated");
  assert.equal(await readFile(target, "utf8"), "updated");
  await assert.rejects(
    () => service.writeFile(target, "stale", snapshot.version),
    (error) => error instanceof WorkspaceFileError && error.code === "workspace-file-conflict",
  );
  assert.equal(await readFile(target, "utf8"), "updated");
  assert.ok(
    (await service.listDirectory(directory)).entries.some((entry) => entry.absolutePath === target),
  );
  for (const input of ["relative.md", String.raw`\\host\share\notes.md`, "/tmp/invalid\0file"]) {
    await assert.rejects(
      () => service.readFile(input),
      (error) =>
        error instanceof WorkspaceFileError && error.code === "workspace-path-outside-root",
    );
  }
  await assert.rejects(
    () => service.readFile(directory),
    (error) => error instanceof WorkspaceFileError && error.code === "workspace-file-not-regular",
  );
});

test("local binary previews share byte ranges, HEAD, query validation and origin protection", async (t) => {
  const { directory, service } = await fixture(t);
  const target = path.join(directory, "preview.png");
  await writeFile(target, new Uint8Array([0, 1, 2, 3, 4]));
  assert.equal((await service.describeFile(target)).encoding, null);
  const handler = createLocalFileContentHandler(service);
  const url = `http://127.0.0.1:3000/api/host.files.content?${new URLSearchParams({ path: target })}`;
  const response = await handler(
    new Request(url, { headers: { host: "127.0.0.1:3000", range: "bytes=1-3" } }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 1-3/5");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const head = await handler(
    new Request(url, { method: "HEAD", headers: { host: "127.0.0.1:3000" } }),
  );
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get("content-length"), "5");
  assert.equal(
    (
      await handler(
        new Request(url, { headers: { host: "127.0.0.1:3000", origin: "http://evil.example" } }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handler(new Request(`${url}&path=duplicate`, { headers: { host: "127.0.0.1:3000" } })))
      .status,
    400,
  );
});

test("local file RPC validates inputs and rejects untrusted requests before accessing files", async (t) => {
  const { directory, service } = await fixture(t);
  const target = path.join(directory, "notes.txt");
  await writeFile(target, "hello");
  const routes = createLocalFileRpcRoutes({
    service,
    projectDomainError(error): never {
      if (error instanceof WorkspaceFileError)
        throw rpcBusinessError(error.code, error.message, {});
      throw error;
    },
  });
  const call = async (method: string, payload: unknown, origin?: string) => {
    const request = new Request(`http://127.0.0.1:3000/api/${method}`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ type: "client-request", rpcId: "test", method, payload }),
    });
    const response = await routes.handle(request, method);
    assert.ok(response);
    return response;
  };
  for (const method of ["host.files.describe", "host.files.read", "host.files.list"]) {
    const body = (await (
      await call(method, { path: method.endsWith("list") ? directory : target })
    ).json()) as { result: { ok: boolean } };
    assert.equal(body.result.ok, true);
  }
  const read = await service.readFile(target);
  const written = (await (
    await call("host.files.write", {
      path: target,
      content: "saved",
      expectedVersion: read.version,
    })
  ).json()) as { result: { ok: boolean } };
  assert.equal(written.result.ok, true);
  assert.equal(await readFile(target, "utf8"), "saved");
  for (const [method, payload] of [
    ["host.files.read", { path: 123 }],
    ["host.files.write", { path: target, content: "bad" }],
  ] as const) {
    const body = (await (await call(method, payload)).json()) as {
      result: { ok: boolean; error: { code: string } };
    };
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(
    (await call("host.files.read", { path: target }, "http://evil.example")).status,
    403,
  );
});
