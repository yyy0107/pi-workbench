"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import {
  createPiWorkspace,
  createPiWorkspaceGitBranch,
  describePiProjectTrust,
  describePiWorkspaceFile,
  fetchPiWorkspaceFileContent,
  describePiWorkspaceGit,
  listPiWorkspaceFiles,
  piWorkspaceFileContentUrl,
  readPiWorkspaceFile,
  readPiWorkspaceGitLog,
  searchPiWorkspaceFiles,
  streamPiWorkspaceFileText,
  switchPiWorkspaceGitBranch,
  updatePiProjectTrust,
  writePiWorkspaceFile,
} from "../transport/api";

export {
  archivePiWorkspaceSession,
  createPiWorkspace,
  createPiWorkspaceGitBranch,
  deletePiWorkspace,
  describePiProjectTrust,
  describePiWorkspaceFile,
  fetchPiWorkspaceFileContent,
  describePiWorkspaceGit,
  insertPiSessionBefore,
  insertPiWorkspaceBefore,
  listPiArchivedWorkspaceSessions,
  listPiWorkspaceFiles,
  listPiWorkspaces,
  piWorkspaceFileContentUrl,
  readPiWorkspaceFile,
  readPiWorkspaceGitLog,
  renamePiWorkspace,
  searchPiWorkspaceFiles,
  setPiWorkspacePinned,
  setPiWorkspaceSessionPinned,
  streamPiWorkspaceFileText,
  switchPiWorkspaceGitBranch,
  unarchivePiWorkspaceSession,
  updatePiProjectTrust,
  writePiWorkspaceFile,
} from "../transport/api";
export type { PiWorkspaceFileTextChunk, StreamPiWorkspaceFileTextOptions } from "../transport/api";
export { usePiWorkspaces } from "../runtime/context";

/** Bind workspace/file operations to the active manager's immutable installation transport. */
export function usePiWorkspaceClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
      describeProjectTrust: (payload: Parameters<typeof describePiProjectTrust>[0]) =>
        describePiProjectTrust(payload, options),
      updateProjectTrust: (payload: Parameters<typeof updatePiProjectTrust>[0]) =>
        updatePiProjectTrust(payload, options),
      listFiles: (payload: Parameters<typeof listPiWorkspaceFiles>[0]) =>
        listPiWorkspaceFiles(payload, options),
      searchFiles: (
        payload: Parameters<typeof searchPiWorkspaceFiles>[0],
        requestOptions?: Omit<Parameters<typeof searchPiWorkspaceFiles>[1], "transport">,
      ) => searchPiWorkspaceFiles(payload, { ...options, ...requestOptions }),
      describeFile: (payload: Parameters<typeof describePiWorkspaceFile>[0]) =>
        describePiWorkspaceFile(payload, options),
      fileContentUrl: (payload: Parameters<typeof piWorkspaceFileContentUrl>[0]) =>
        piWorkspaceFileContentUrl(payload),
      fetchFileContent: (
        payload: Parameters<typeof fetchPiWorkspaceFileContent>[0],
        requestOptions?: Omit<Parameters<typeof fetchPiWorkspaceFileContent>[1], "transport">,
      ) => fetchPiWorkspaceFileContent(payload, { ...options, ...requestOptions }),
      readFile: (payload: Parameters<typeof readPiWorkspaceFile>[0]) =>
        readPiWorkspaceFile(payload, options),
      writeFile: (payload: Parameters<typeof writePiWorkspaceFile>[0]) =>
        writePiWorkspaceFile(payload, options),
      streamFileText: (
        payload: Parameters<typeof streamPiWorkspaceFileText>[0],
        streamOptions: Omit<Parameters<typeof streamPiWorkspaceFileText>[1], "transport">,
      ) => streamPiWorkspaceFileText(payload, { ...streamOptions, ...options }),
      describeGit: (
        payload: Parameters<typeof describePiWorkspaceGit>[0],
        requestOptions?: Omit<Parameters<typeof describePiWorkspaceGit>[1], "transport">,
      ) => describePiWorkspaceGit(payload, { ...options, ...requestOptions }),
      readGitLog: (
        payload: Parameters<typeof readPiWorkspaceGitLog>[0],
        requestOptions?: Omit<Parameters<typeof readPiWorkspaceGitLog>[1], "transport">,
      ) => readPiWorkspaceGitLog(payload, { ...options, ...requestOptions }),
      switchGitBranch: (payload: Parameters<typeof switchPiWorkspaceGitBranch>[0]) =>
        switchPiWorkspaceGitBranch(payload, options),
      createGitBranch: (payload: Parameters<typeof createPiWorkspaceGitBranch>[0]) =>
        createPiWorkspaceGitBranch(payload, options),
      createWorkspace: (path: string) => createPiWorkspace(path, options),
    };
  }, [manager]);
}
