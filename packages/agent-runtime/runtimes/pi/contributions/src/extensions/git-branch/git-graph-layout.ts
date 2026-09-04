import type { WorkspaceGitCommit } from "@workbench/agent-runtime-pi-protocol/rpc";

interface GitGraphLane {
  hash: string;
  colorIndex: number;
}

export interface GitGraphSegment {
  fromLane: number;
  toLane: number;
  colorIndex: number;
}

export interface GitGraphRowLayout {
  commit: WorkspaceGitCommit;
  lane: number;
  laneCount: number;
  colorIndex: number;
  introduced: boolean;
  throughSegments: GitGraphSegment[];
  parentSegments: GitGraphSegment[];
}

export interface GitGraphLayout {
  rows: GitGraphRowLayout[];
  maxLaneCount: number;
}

/**
 * Projects Git's `--topo-order` output into stable lanes. The first parent keeps the current
 * lane color, while additional merge parents receive their own colors.
 */
export function createGitGraphLayout(commits: readonly WorkspaceGitCommit[]): GitGraphLayout {
  let lanes: GitGraphLane[] = [];
  let nextColorIndex = 0;
  let maxLaneCount = 0;
  const rows: GitGraphRowLayout[] = [];

  for (const commit of commits) {
    let lane = lanes.findIndex((candidate) => candidate.hash === commit.hash);
    const introduced = lane < 0;
    if (introduced) {
      lane = lanes.length;
      lanes.push({ hash: commit.hash, colorIndex: nextColorIndex++ });
    }

    const before = lanes;
    const current = before[lane];
    if (!current) continue;
    const after = before.filter((_candidate, index) => index !== lane);
    let insertedParents = 0;

    for (const [parentIndex, parentHash] of commit.parentHashes.entries()) {
      if (after.some((candidate) => candidate.hash === parentHash)) continue;
      const insertionIndex = Math.min(lane + insertedParents, after.length);
      after.splice(insertionIndex, 0, {
        hash: parentHash,
        colorIndex: parentIndex === 0 ? current.colorIndex : nextColorIndex++,
      });
      insertedParents += 1;
    }

    const throughSegments = before.flatMap<GitGraphSegment>((candidate, index) => {
      if (index === lane) return [];
      const nextLane = after.findIndex((next) => next.hash === candidate.hash);
      return nextLane < 0
        ? []
        : [{ fromLane: index, toLane: nextLane, colorIndex: candidate.colorIndex }];
    });
    const parentSegments = commit.parentHashes.flatMap<GitGraphSegment>((parentHash) => {
      const nextLane = after.findIndex((candidate) => candidate.hash === parentHash);
      const parent = after[nextLane];
      return nextLane < 0 || !parent
        ? []
        : [{ fromLane: lane, toLane: nextLane, colorIndex: parent.colorIndex }];
    });
    const laneCount = Math.max(before.length, after.length, 1);
    maxLaneCount = Math.max(maxLaneCount, laneCount);
    rows.push({
      commit,
      lane,
      laneCount,
      colorIndex: current.colorIndex,
      introduced,
      throughSegments,
      parentSegments,
    });
    lanes = after;
  }

  return { rows, maxLaneCount };
}
