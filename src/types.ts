import type { WclOrigin, WclRegion } from './constants.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type FightSelector = number | 'last';
export type WclAccessMode = 'auto' | 'public' | 'user';
export type CharacterRegion = 'us' | 'eu' | 'kr' | 'tw' | 'cn';

export type CharacterIdentity = {
  name: string;
  serverSlug: string;
  serverRegion: CharacterRegion;
  apiRegion: WclRegion;
};

export type ParsedReportUrl = {
  origin: WclOrigin;
  region: WclRegion;
  reportCode: string;
  fight: FightSelector | null;
  canonicalUrl: string;
};

export type ReportReference = ParsedReportUrl & {
  inputWasUrl: boolean;
};

export type WclConfig = {
  clientId?: string;
  clientSecret?: string;
  userAccessTokens: Partial<Record<WclRegion, string>>;
  userTokenExpiresAt: Partial<Record<WclRegion, number>>;
  stateDirectory: string;
  requestTimeoutMs: number;
  maxRetries: number;
  maxRetryAfterMs: number;
};

export type QueryAccess = {
  mode?: WclAccessMode | undefined;
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;

export type GraphqlErrorItem = {
  message: string;
  path?: (number | string)[];
  extensions?: Record<string, unknown>;
};

export type GraphqlEnvelope<T> = {
  data?: T | null;
  errors?: GraphqlErrorItem[];
};

export type ReportArchiveStatus = {
  isArchived: boolean;
  isAccessible: boolean;
  archiveDate: number | null;
};

export type ReportSummary = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  visibility: string;
  revision: number;
  segments: number;
  exportedSegments: number;
  zone: { id: number; name: string } | null;
  archiveStatus: ReportArchiveStatus | null;
};

export type ReportActor = {
  id: number | null;
  gameID: number | null;
  name: string | null;
  server: string | null;
  type: string | null;
  subType: string | null;
  icon: string | null;
  petOwner: number | null;
};

export type ReportFight = {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  encounterID: number;
  originalEncounterID: number | null;
  kill: boolean | null;
  difficulty: number | null;
  size: number | null;
  inProgress: boolean | null;
  averageItemLevel: number | null;
  friendlyPlayers: (number | null)[];
  friendlySpecs: (string | null)[];
  friendlyItemLevels: (number | null)[];
  gameZone: { id: number; name: string } | null;
  maps: { id: number }[];
  keystoneLevel: number | null;
  keystoneTime: number | null;
  keystoneBonus: number | null;
  keystoneAffixes: (number | null)[];
  rating: number | null;
  countReached: number | null;
  countRequired: number | null;
};

export type DungeonPull = {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  encounterID: number;
  kill: boolean | null;
  x: number;
  y: number;
  maps: { id: number }[];
  enemyNPCs: {
    id: number | null;
    gameID: number | null;
    minimumInstanceID: number | null;
    maximumInstanceID: number | null;
    minimumInstanceGroupID: number | null;
    maximumInstanceGroupID: number | null;
  }[];
};

export type PlayerSummary = ReportActor & {
  fightIDs: number[];
  specs: string[];
  itemLevels: number[];
};

export const TABLE_DATA_TYPES = [
  'Buffs',
  'Casts',
  'DamageDone',
  'DamageTaken',
  'Deaths',
  'Debuffs',
  'Dispels',
  'Healing',
  'Interrupts',
  'Resources',
] as const;
export type TableDataType = (typeof TABLE_DATA_TYPES)[number];

export const EVENT_DATA_TYPES = [
  'All',
  'Buffs',
  'Casts',
  'CombatantInfo',
  'DamageDone',
  'DamageTaken',
  'Deaths',
  'Debuffs',
  'Dispels',
  'Healing',
  'Interrupts',
  'Resources',
  'Summons',
  'Threat',
] as const;
export type EventDataType = (typeof EVENT_DATA_TYPES)[number];

export const VIEW_TYPES = ['Default', 'Ability', 'Source', 'Target'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export type TableFilter = {
  sourceID?: number | undefined;
  targetID?: number | undefined;
  abilityID?: number | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;
  viewBy?: ViewType | undefined;
  translate?: boolean | undefined;
};

export type NormalizedTable = {
  dataType: TableDataType;
  fightID: number;
  filter: TableFilter;
  data: JsonValue;
  meta: {
    bytes: number;
    originalEntryCount: number | null;
    returnedEntryCount: number | null;
    truncated: boolean;
    maxEntries: number;
    maxPayloadBytes: number;
  };
};

export type EventQuery = {
  dataType: EventDataType;
  sourceID?: number | undefined;
  targetID?: number | undefined;
  abilityID?: number | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;
  cursor?: number | undefined;
  includeResources?: boolean | undefined;
  translate?: boolean | undefined;
  maxEvents?: number | undefined;
  pageSize?: number | undefined;
  maxPages?: number | undefined;
  maxPayloadBytes?: number | undefined;
};

export type EventPage = {
  data: JsonValue[];
  nextPageTimestamp: number | null;
};

export type RecentReport = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  visibility: string;
  owner: { name: string } | null;
  zone: { id: number; name: string } | null;
  fights: {
    id: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean | null;
    difficulty: number | null;
    fightPercentage: number | null;
    keystoneLevel: number | null;
  }[];
};

export type CharacterProfile = CharacterIdentity & {
  id: number;
  canonicalID: number;
  classID: number;
  level: number;
  hidden: boolean;
  faction: { id: number; name: string };
  server: {
    id: number;
    name: string;
    normalizedName: string;
    slug: string;
    region: { id: number; name: string; compactName: string; slug: string };
  };
  guilds: { id: number; name: string }[];
};

export type CharacterSubscription = {
  id: string;
  character: CharacterIdentity;
  accessMode: WclAccessMode;
  createdAt: string;
  lastCheckedAt: string | null;
  lastSeenReportStartTime: number;
  seenReportCodesAtBoundary: string[];
};
