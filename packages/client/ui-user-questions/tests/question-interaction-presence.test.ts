import assert from "node:assert/strict";
import test from "node:test";

import {
  completeQuestionExit,
  createQuestionPresence,
  expectQuestionContinuation,
  expireQuestionContinuation,
  reconcileQuestionPresence,
  type QuestionInteraction,
} from "../lib/question-interaction-presence";

const owner = {};
const sessionId = "session";
const questions = [
  { id: "first", question: "First question?" },
  { id: "second", question: "Second question?" },
];

function question(requestId: string, currentIndex = 0): QuestionInteraction {
  return {
    kind: "question",
    requestId,
    sessionId,
    questions,
    progress: { currentIndex, answers: [] },
  };
}

test("keeps the initial request identity across a handoff with an empty store snapshot", () => {
  const first = question("request-1");
  let state = createQuestionPresence(owner, sessionId, first);
  state = expectQuestionContinuation(state, state.scopeRevision, first.requestId, 1);
  state = reconcileQuestionPresence(state, owner, sessionId, undefined);
  assert.equal(state.group?.phase, "waiting");
  assert.equal(state.group?.question, first);
  const next = question("request-2", 1);
  state = reconcileQuestionPresence(state, owner, sessionId, next);
  assert.equal(state.group?.phase, "active");
  assert.equal(state.group?.initialRequestId, first.requestId);
  assert.equal(state.group?.question, next);
  assert.equal(state.group?.expectedIndex, undefined);
});

test("a consecutive request can arrive before a pending removal snapshot is observed", () => {
  const first = question("request-1");
  let state = createQuestionPresence(owner, sessionId, first);
  state = expectQuestionContinuation(state, state.scopeRevision, first.requestId, 1);
  state = reconcileQuestionPresence(state, owner, sessionId, question("request-2", 1));
  assert.equal(state.group?.initialRequestId, "request-1");
  assert.equal(state.group?.question.requestId, "request-2");
  assert.equal(state.group?.phase, "active");
});

test("refreshes retained metadata before a request leaves the store", () => {
  const first = question("request-1");
  const updated = {
    ...first,
    expiresAt: 123,
    progress: { currentIndex: 0, answers: [{ id: "first", selected: [], custom: "answer" }] },
  };
  let state = createQuestionPresence(owner, sessionId, first);
  state = reconcileQuestionPresence(state, owner, sessionId, updated);
  state = reconcileQuestionPresence(state, owner, sessionId, undefined);
  assert.equal(state.group?.phase, "exiting");
  assert.equal(state.group?.question, updated);
});

test("unrelated flows with reused question IDs get independent request identities", () => {
  let state = createQuestionPresence(owner, sessionId, question("flow-1"));
  const second = question("flow-2");
  state = reconcileQuestionPresence(state, owner, sessionId, second);
  assert.equal(state.group?.phase, "exiting");
  assert.equal(state.group?.initialRequestId, "flow-1");
  state = completeQuestionExit(state, state.revision);
  assert.equal(state.group?.phase, "active");
  assert.equal(state.group?.initialRequestId, "flow-2");
});

test("matching IDs and progress do not join different question schemas", () => {
  let state = createQuestionPresence(owner, sessionId, question("flow-1"));
  state = expectQuestionContinuation(state, state.scopeRevision, "flow-1", 1);
  state = reconcileQuestionPresence(state, owner, sessionId, {
    ...question("flow-2", 1),
    questions: [{ ...questions[0], question: "An unrelated first question?" }, questions[1]],
  });
  assert.equal(state.group?.phase, "exiting");
});

test("provider and session changes discard the retained flow immediately", () => {
  let state = createQuestionPresence(owner, sessionId, question("same-request-id"));
  const previousScope = state.scopeRevision;
  const previousRevision = state.revision;
  const newOwner = {};
  state = reconcileQuestionPresence(state, newOwner, sessionId, question("same-request-id"));
  assert.equal(state.scopeRevision, previousScope + 1);
  assert.equal(expectQuestionContinuation(state, previousScope, "same-request-id", 1), state);
  assert.equal(completeQuestionExit(state, previousRevision), state);
  state = reconcileQuestionPresence(state, newOwner, "other-session", undefined);
  assert.equal(state.group, undefined);
  state = reconcileQuestionPresence(state, undefined, "other-session", question("stale"));
  assert.equal(state.group, undefined);
});

test("only the current waiting revision can expire a continuation", () => {
  let state = createQuestionPresence(owner, sessionId, question("request-1"));
  state = expectQuestionContinuation(state, state.scopeRevision, "request-1", 1);
  state = reconcileQuestionPresence(state, owner, sessionId, undefined);
  const waitingRevision = state.revision;
  const waitingState = state;
  state = reconcileQuestionPresence(state, owner, sessionId, question("request-2", 1));
  assert.equal(expireQuestionContinuation(state, waitingRevision), state);
  const expired = expireQuestionContinuation(waitingState, waitingRevision);
  assert.equal(expired.group?.phase, "exiting");
  assert.equal(expired.group?.expectedIndex, undefined);
  assert.equal(completeQuestionExit(expired, expired.revision).group, undefined);
});

test("a timeout cannot affect a later handoff in the same group", () => {
  let state = createQuestionPresence(owner, sessionId, question("request-1"));
  state = expectQuestionContinuation(state, state.scopeRevision, "request-1", 1);
  state = reconcileQuestionPresence(state, owner, sessionId, undefined);
  const staleRevision = state.revision;
  state = reconcileQuestionPresence(state, owner, sessionId, question("request-2", 1));
  state = expectQuestionContinuation(state, state.scopeRevision, "request-2", 0);
  state = reconcileQuestionPresence(state, owner, sessionId, undefined);
  assert.equal(expireQuestionContinuation(state, staleRevision), state);
  assert.equal(state.group?.phase, "waiting");
});

test("exit completion uses the latest replacement and stale completions are ignored", () => {
  let state = createQuestionPresence(owner, sessionId, question("request-1"));
  state = reconcileQuestionPresence(state, owner, sessionId, question("request-2"));
  const exitRevision = state.revision;
  const latest = question("request-3");
  state = reconcileQuestionPresence(state, owner, sessionId, latest);
  state = completeQuestionExit(state, exitRevision);
  assert.equal(state.group?.question, latest);
  assert.equal(completeQuestionExit(state, exitRevision), state);
});

test("a failed handoff clears its expectation without touching a newer request", () => {
  let state = createQuestionPresence(owner, sessionId, question("request-1"));
  state = expectQuestionContinuation(state, state.scopeRevision, "request-1", 1);
  state = expectQuestionContinuation(state, state.scopeRevision, "request-1", undefined);
  assert.equal(state.group?.expectedIndex, undefined);
  assert.equal(state.group?.phase, "active");
  state = expectQuestionContinuation(state, state.scopeRevision, "request-1", 1);
  state = reconcileQuestionPresence(state, owner, sessionId, question("request-2", 1));
  state = expectQuestionContinuation(state, state.scopeRevision, "request-2", 0);
  assert.equal(
    expectQuestionContinuation(state, state.scopeRevision, "request-1", undefined),
    state,
  );
  assert.equal(state.group?.expectedIndex, 0);
});
