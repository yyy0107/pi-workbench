import { Writable } from "node:stream";

export interface WebControlStdoutLease {
  readonly output: Writable;
  release(): void;
}

/**
 * Reserves stdout for Web Host control frames before Next or the application graph is imported.
 * Any incidental process stdout write is redirected to stderr for the lifetime of the lease.
 */
export function claimWebControlStdout(
  stdout: Writable = process.stdout,
  stderr: Writable = process.stderr,
): WebControlStdoutLease {
  const ownDescriptor = Object.getOwnPropertyDescriptor(stdout, "write");
  const originalWrite = stdout.write;
  const redirectedWrite = function (...arguments_: unknown[]): boolean {
    return Reflect.apply(stderr.write, stderr, arguments_) as boolean;
  } as Writable["write"];
  Object.defineProperty(stdout, "write", {
    configurable: true,
    value: redirectedWrite,
    writable: true,
  });

  const output = new Writable({
    write(chunk, encoding, callback) {
      Reflect.apply(originalWrite, stdout, [chunk, encoding, callback]);
    },
  });
  let released = false;
  return Object.freeze({
    output,
    release() {
      if (released) return;
      released = true;
      output.destroy();
      if (ownDescriptor) Object.defineProperty(stdout, "write", ownDescriptor);
      else Reflect.deleteProperty(stdout, "write");
    },
  });
}
