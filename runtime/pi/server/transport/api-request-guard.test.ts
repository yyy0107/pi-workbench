import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "./local-api-request-trust" ? `${specifier}.ts` : specifier,
      context,
    );
  },
});
const { rejectUntrustedApiRequest } = (await import(
  new URL("./api-request-guard.ts", import.meta.url).href
)) as typeof import("./api-request-guard");
moduleHooks.deregister();

function request(host: string, origin?: string): { headers: Headers } {
  return { headers: new Headers({ host, ...(origin ? { origin } : {}) }) };
}

test("guards legacy APIs with the same configured trust policy", (t) => {
  const previous = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:8443";
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previous;
  });

  assert.equal(rejectUntrustedApiRequest(request("127.0.0.1:3000")), undefined);
  assert.equal(
    rejectUntrustedApiRequest(request("workbench.example:8443", "https://workbench.example:8443")),
    undefined,
  );
  assert.equal(rejectUntrustedApiRequest(request("evil.example:3000"))?.status, 403);
  assert.equal(
    rejectUntrustedApiRequest(request("workbench.example:8443"), { loopbackOnly: true })?.status,
    403,
  );
});
