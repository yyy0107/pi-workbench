import { PiConversationAssembler } from "../packages/agent-runtime/runtimes/pi/client/src/conversation/conversation-assembler";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
  appendConversationDelta,
  longConversation,
} from "../packages/agent-runtime/runtimes/pi/client/test/fixtures/long-conversation";

async function main() {
  const baseline = process.argv.find((argument) => argument.startsWith("--baseline="))?.slice(11);
  let Assembler = PiConversationAssembler;
  if (baseline) {
    const require = createRequire(path.resolve("package.json"));
    const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
    const relative =
      "packages/agent-runtime/runtimes/pi/client/src/conversation/conversation-assembler.ts";
    const result = await build({
      stdin: {
        contents: execFileSync("git", ["show", `${baseline}:${relative}`], { encoding: "utf8" }),
        resolveDir: path.resolve("packages/agent-runtime/runtimes/pi/client/src/conversation"),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
    });
    Assembler = (
      await import(
        `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
      )
    ).PiConversationAssembler;
  }

  function percentile(values: number[], fraction: number) {
    return values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!;
  }

  for (const count of [100, 1_000, 5_000]) {
    const runs = [];
    for (let run = 0; run < 6; run++) {
      const assembler = new Assembler(`benchmark-${run}`);
      let messages = longConversation(count);
      const projection = () => ({ messages, isLoading: false, isRunning: true });
      assembler.update(projection());
      const stream = [];
      const composer = [];
      for (let chunk = 0; chunk < 30; chunk++) {
        messages = appendConversationDelta(messages, " streamed delta");
        let start = performance.now();
        assembler.update(projection());
        stream.push(performance.now() - start);
        start = performance.now();
        assembler.update({
          ...projection(),
          composer: { text: `draft ${chunk}`, attachments: [], mode: "send", phase: "idle" },
        });
        composer.push(performance.now() - start);
      }
      if (run > 0)
        runs.push({ streamP95: percentile(stream, 0.95), composerP95: percentile(composer, 0.95) });
      assembler.dispose();
    }
    console.log(
      JSON.stringify({
        count,
        runs,
        medianStreamP95: percentile(
          runs.map((run) => run.streamP95),
          0.5,
        ),
        medianComposerP95: percentile(
          runs.map((run) => run.composerP95),
          0.5,
        ),
      }),
    );
  }
}
void main();
