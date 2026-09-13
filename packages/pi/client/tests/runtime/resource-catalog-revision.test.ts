import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PiResourceCatalogRevision } from "../../src/runtime/resource-catalog-revision";
import { PiSessionManager } from "../../src/runtime/manager";
import { PiSessionManagerProvider } from "../../src/runtime/context";
import { usePiResourceClient, type PiResourceClient } from "../../src/public/resources";

test("resource catalog revisions are isolated per installation", () => {
  const first = new PiResourceCatalogRevision();
  const second = new PiResourceCatalogRevision();
  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribeFirst = first.subscribe(() => {
    firstNotifications += 1;
  });
  const unsubscribeSecond = second.subscribe(() => {
    secondNotifications += 1;
  });

  first.invalidate();
  assert.equal(first.getRevision(), 1);
  assert.equal(second.getRevision(), 0);
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);

  second.invalidate();
  assert.equal(first.getRevision(), 1);
  assert.equal(second.getRevision(), 1);
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 1);

  unsubscribeFirst();
  unsubscribeSecond();
});

test("manual refresh and prompt mutations notify sidebar and page subscribers together", async (t) => {
  const manager = new PiSessionManager({
    transport: {
      async http(_path, init) {
        const request = JSON.parse(String(init?.body));
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: { ok: true, value: { removed: true } },
        });
      },
    },
  });
  t.after(() => manager.dispose());
  const clients: PiResourceClient[] = [];
  function Capture() {
    clients.push(usePiResourceClient());
    return null;
  }
  for (let index = 0; index < 2; index++) {
    renderToStaticMarkup(
      createElement(PiSessionManagerProvider, { manager, children: createElement(Capture) }),
    );
  }
  const [sidebar, page] = clients;
  const observed: number[][] = [[], []];
  for (const [index, client] of clients.entries()) {
    t.after(client.subscribeCatalog(() => observed[index].push(client.getCatalogRevision())));
  }

  page.refreshCatalog();
  await page.savePrompt({ target: { scope: "user" }, name: "review", content: "Review changes" });
  await page.removePrompt({ target: { scope: "user" }, id: "review", version: "1" });
  assert.deepEqual(observed, [
    [1, 2, 3],
    [1, 2, 3],
  ]);
  assert.equal(sidebar.getCatalogRevision(), page.getCatalogRevision());
});
