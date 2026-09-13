import type {
  PiConversationMessageRepository,
  PiConversationMessage,
} from "@workbench/pi-conversation-adapter/model";
import type { SessionHistoryValue } from "@workbench/pi-rpc-contracts/rpc";

/** Single owner for one client's canonical history, branch and request-generation state. */
export class PiClientSessionHistoryState {
  baseMessages: PiConversationMessage[] = [];
  baseMessageRepository: PiConversationMessageRepository = { headId: null, messages: [] };
  baseMessageRepositoryIndex?: {
    repository: PiConversationMessageRepository;
    byId: ReadonlyMap<string, number>;
  };
  branchLeafByHeadMessageId = new Map<string, string>();
  branchSwitchTask?: Promise<void>;
  branchPreview?: {
    messages: readonly PiConversationMessage[];
    repository: PiConversationMessageRepository;
    leaves: ReadonlyMap<string, string>;
  };
  reloadTask?: Promise<void>;
  loadOlderTask?: Promise<void>;
  loadedHistory?: SessionHistoryValue;
  hasMore = false;
  rebaselineGeneration = 0;
  lastSequence = -1;

  acceptSequence(sequence: number | undefined): boolean {
    if (sequence === undefined) return true;
    if (sequence <= this.lastSequence) return false;
    this.lastSequence = sequence;
    return true;
  }

  rebaselineSequence(sequence: number): boolean {
    const changed = this.lastSequence !== sequence;
    this.lastSequence = sequence;
    return changed;
  }

  mergeOlder(page: SessionHistoryValue, current = this.loadedHistory): SessionHistoryValue {
    if (!current) return page;
    const entryIds = new Set(
      current.events.flatMap(({ event }) => (event.entryId ? [event.entryId] : [])),
    );
    const sequences = new Set(current.events.map(({ event }) => event.seq));
    const older = page.events.filter(({ event }) =>
      event.entryId ? !entryIds.has(event.entryId) : !sequences.has(event.seq),
    );
    return { ...page, ...current, events: [...older, ...current.events], hasMore: page.hasMore };
  }

  replaceBase(
    messages: PiConversationMessage[],
    repository: PiConversationMessageRepository,
    leaves: Map<string, string>,
    loaded: SessionHistoryValue,
  ): void {
    this.baseMessages = messages;
    this.baseMessageRepository = repository;
    this.baseMessageRepositoryIndex = undefined;
    this.branchLeafByHeadMessageId = leaves;
    this.loadedHistory = loaded;
    this.hasMore = loaded.hasMore;
  }

  repositoryIndex(): ReadonlyMap<string, number> {
    if (this.baseMessageRepositoryIndex?.repository !== this.baseMessageRepository) {
      this.baseMessageRepositoryIndex = {
        repository: this.baseMessageRepository,
        byId: new Map(
          this.baseMessageRepository.messages.map((item, index) => [item.message.id, index]),
        ),
      };
    }
    return this.baseMessageRepositoryIndex.byId;
  }

  dispose(): void {
    this.rebaselineGeneration += 1;
    this.baseMessages = [];
    this.baseMessageRepository = { headId: null, messages: [] };
    this.baseMessageRepositoryIndex = undefined;
    this.branchLeafByHeadMessageId.clear();
    this.branchPreview = undefined;
    this.loadedHistory = undefined;
    this.hasMore = false;
    this.lastSequence = -1;
  }
}
