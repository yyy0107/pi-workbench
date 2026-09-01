/**
 * Opaque implementation-owned tokens echoed only to the Agent Runtime that produced them.
 *
 * They deliberately remain strings so they are JSON-safe and do not impose a shared branch,
 * journal, or checkpoint model on concrete runtimes.
 */
export type AgentStateToken = string;
export type AgentBranchToken = string;
export type AgentForkPointToken = string;
export type AgentMutationToken = string;
