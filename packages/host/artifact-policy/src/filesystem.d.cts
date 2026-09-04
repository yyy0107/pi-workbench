import type path from "node:path";

export interface DirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}
export function isInside(parent: string, candidate: string, pathApi?: typeof path): boolean;
export function canonicalPathSpelling(
  candidate: string,
  label: string,
  pathApi?: typeof path,
): string;
export function directoryIdentity(directory: string, label: string): Promise<DirectoryIdentity>;
export function optionalDirectoryIdentity(
  directory: string,
  label: string,
): Promise<DirectoryIdentity | undefined>;
export function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean;
