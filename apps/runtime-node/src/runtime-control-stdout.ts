import { Writable } from "node:stream";

export interface RuntimeControlStdoutLease {
  readonly output: Writable;
  release(): void;
}

/**
 * Reserves stdout for Runtime Host control frames before the application graph is imported.
 *
 * The returned Writable bypasses the temporary redirect through the exact writer captured at
 * acquisition time. Any application or dependency that writes through the process stdout object
 * while the lease is active is sent to stderr instead, where ordinary diagnostics belong.
 */
export function claimRuntimeControlStdout(
  stdout: Writable = process.stdout,
  stderr: Writable = process.stderr,
): RuntimeControlStdoutLease {
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
