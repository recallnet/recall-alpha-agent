import {
  UUID,
  Account,
  Memory,
  Actor,
  GoalStatus,
  Goal,
  Participant,
  RAGKnowledgeItem,
  Relationship,
  IAgentRuntime,
  AgentRuntime,
} from '@elizaos/core';

export interface ICotDatabaseAdapter {
  /** Database instance */
  db: any;
  /** Optional initialization */
  init(): Promise<void>;
  /** Close database connection */
  close(): Promise<void>;
  /** Get account by ID */
  getAccountById(userId: UUID): Promise<Account | null>;
  /** Create new account */
  createAccount(account: Account): Promise<boolean>;
  /** Get memories matching criteria */
  getMemories(params: {
    roomId: UUID;
    count?: number;
    unique?: boolean;
    tableName: string;
    agentId: UUID;
    start?: number;
    end?: number;
  }): Promise<Memory[]>;
  getMemoryById(id: UUID): Promise<Memory | null>;
  getMemoriesByIds(ids: UUID[], tableName?: string): Promise<Memory[]>;
  getMemoriesByRoomIds(params: {
    tableName: string;
    agentId: UUID;
    roomIds: UUID[];
    limit?: number;
  }): Promise<Memory[]>;
  getCachedEmbeddings(params: {
    query_table_name: string;
    query_threshold: number;
    query_input: string;
    query_field_name: string;
    query_field_sub_name: string;
    query_match_count: number;
  }): Promise<
    {
      embedding: number[];
      levenshtein_score: number;
    }[]
  >;

  /** Log single event */
  log(params: {
    body: { [key: string]: unknown };
    userId: UUID;
    roomId: UUID;
    type: string;
  }): Promise<void>;

  /** Batch log memory event */
  logMemory(params: {
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    type: string;
    body: string;
  }): Promise<void>;

  /** Retrieve unsynced logs */
  getUnsyncedLogs(): Promise<
    {
      id: UUID;
      body: any;
      userId: UUID;
      roomId: UUID;
      type: string;
      createdAt: Date;
    }[]
  >;

  /** Mark logs as synced */
  markLogsAsSynced(logIds: UUID[]): Promise<void>;

  getActorDetails(params: { roomId: UUID }): Promise<Actor[]>;

  searchMemories(params: {
    tableName: string;
    agentId: UUID;
    roomId: UUID;
    embedding: number[];
    match_threshold: number;
    match_count: number;
    unique: boolean;
  }): Promise<Memory[]>;

  updateGoalStatus(params: { goalId: UUID; status: GoalStatus }): Promise<void>;

  searchMemoriesByEmbedding(
    embedding: number[],
    params: {
      match_threshold?: number;
      count?: number;
      roomId?: UUID;
      agentId?: UUID;
      unique?: boolean;
      tableName: string;
    },
  ): Promise<Memory[]>;

  createMemory(memory: Memory, tableName: string, unique?: boolean): Promise<void>;
  removeMemory(memoryId: UUID, tableName: string): Promise<void>;
  removeAllMemories(roomId: UUID, tableName: string): Promise<void>;
  countMemories(roomId: UUID, unique?: boolean, tableName?: string): Promise<number>;

  getGoals(params: {
    agentId: UUID;
    roomId: UUID;
    userId?: UUID | null;
    onlyInProgress?: boolean;
    count?: number;
  }): Promise<Goal[]>;

  updateGoal(goal: Goal): Promise<void>;
  createGoal(goal: Goal): Promise<void>;
  removeGoal(goalId: UUID): Promise<void>;
  removeAllGoals(roomId: UUID): Promise<void>;

  getRoom(roomId: UUID): Promise<UUID | null>;
  createRoom(roomId?: UUID): Promise<UUID>;
  removeRoom(roomId: UUID): Promise<void>;
  getRoomsForParticipant(userId: UUID): Promise<UUID[]>;
  getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]>;

  addParticipant(userId: UUID, roomId: UUID): Promise<boolean>;
  removeParticipant(userId: UUID, roomId: UUID): Promise<boolean>;
  getParticipantsForAccount(userId: UUID): Promise<Participant[]>;
  getParticipantsForRoom(roomId: UUID): Promise<UUID[]>;

  getParticipantUserState(roomId: UUID, userId: UUID): Promise<'FOLLOWED' | 'MUTED' | null>;
  setParticipantUserState(
    roomId: UUID,
    userId: UUID,
    state: 'FOLLOWED' | 'MUTED' | null,
  ): Promise<void>;

  createRelationship(params: { userA: UUID; userB: UUID }): Promise<boolean>;
  getRelationship(params: { userA: UUID; userB: UUID }): Promise<Relationship | null>;
  getRelationships(params: { userId: UUID }): Promise<Relationship[]>;

  getKnowledge(params: {
    id?: UUID;
    agentId: UUID;
    limit?: number;
    query?: string;
    conversationContext?: string;
  }): Promise<RAGKnowledgeItem[]>;

  searchKnowledge(params: {
    agentId: UUID;
    embedding: Float32Array;
    match_threshold: number;
    match_count: number;
    searchText?: string;
  }): Promise<RAGKnowledgeItem[]>;

  createKnowledge(knowledge: RAGKnowledgeItem): Promise<void>;
  removeKnowledge(id: UUID): Promise<void>;
  clearKnowledge(agentId: UUID, shared?: boolean): Promise<void>;
}
export interface ICotAgentRuntime extends IAgentRuntime {
  databaseAdapter: ICotDatabaseAdapter;
}

export interface CotAgentRuntime extends Omit<AgentRuntime, 'db'> {
  databaseAdapter: ICotDatabaseAdapter;
}
