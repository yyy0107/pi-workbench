import assert from "node:assert/strict";
import test from "node:test";

import {
  TerminalAnsiTextDecoder,
  TerminalTranscriptProjector,
} from "./terminal-transcript-projector";

test("strips ANSI sequences that are split across PTY chunks", () => {
  const decoder = new TerminalAnsiTextDecoder();

  assert.equal(decoder.feed("\u001b["), "");
  assert.equal(decoder.feed("31mred\u001b[0"), "red");
  assert.equal(decoder.feed("m text"), " text");
  assert.equal(decoder.flush(), "");
});

test("keeps ordinary output append-only across chunk boundaries", () => {
  const projector = new TerminalTranscriptProjector();

  assert.equal(projector.feed("first"), "");
  assert.equal(projector.feed(" line\r"), "");
  assert.equal(projector.feed("\nsecond\n"), "first line\nsecond\n");
  assert.equal(projector.flush(), "");
});

test("coalesces carriage-return redraws into the final stable line", () => {
  const projector = new TerminalTranscriptProjector();

  assert.equal(projector.feed("Cloning 10%\rCloning 20%\r"), "");
  assert.equal(projector.feed("Cloning 100%\r\n"), "Cloning 100%\n");
  assert.equal(projector.flush(), "");
});

test("applies backspace edits and flushes a final unterminated prompt", () => {
  const projector = new TerminalTranscriptProjector();

  assert.equal(projector.feed("Passwrod\b\b\bord: "), "");
  assert.equal(projector.flush(), "Password: ");
});

test("bounds an unterminated line without losing its append-only transcript", () => {
  const projector = new TerminalTranscriptProjector({ maxPendingLineChars: 4 });

  assert.equal(projector.feed("abcdef"), "ab");
  assert.equal(projector.flush(), "cdef");
});
