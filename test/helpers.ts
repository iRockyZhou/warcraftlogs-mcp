import type { FetchLike, WclConfig } from '../src/types.js';

export const TEST_CONFIG: WclConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  userAccessTokens: {},
  userTokenExpiresAt: {},
  stateDirectory: '/tmp/warcraftlogs-mcp-test',
  requestTimeoutMs: 1_000,
  maxRetries: 2,
  maxRetryAfterMs: 2_000,
};

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export type FetchCall = { input: string | URL; init: RequestInit | undefined };

export function queueFetch(responses: Response[]): { fetcher: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetcher: FetchLike = (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (response === undefined) throw new Error('No queued response');
    return Promise.resolve(response);
  };
  return { fetcher, calls };
}

export function requestHeader(call: FetchCall | undefined, name: string): string | null {
  if (call?.init?.headers === undefined) return null;
  return new Headers(call.init.headers).get(name);
}

export function requestBody(call: FetchCall | undefined): Record<string, unknown> {
  const body = call?.init?.body;
  if (typeof body !== 'string') throw new Error('Expected a string request body');
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected an object request body');
  }
  return parsed as Record<string, unknown>;
}

export const FIGHT = {
  id: 1,
  name: 'Test Dungeon',
  startTime: 0,
  endTime: 10_000,
  encounterID: 0,
  originalEncounterID: null,
  kill: true,
  difficulty: 10,
  size: 5,
  inProgress: false,
  averageItemLevel: 300,
  friendlyPlayers: [1, 2],
  friendlySpecs: ['Retribution', 'Holy'],
  friendlyItemLevels: [301, 299],
  gameZone: { id: 42, name: 'Test Dungeon' },
  maps: [{ id: 100 }],
  keystoneLevel: 10,
  keystoneTime: 10_000,
  keystoneBonus: 2,
  keystoneAffixes: [9, 10],
  rating: 123.4,
  countReached: 100,
  countRequired: 100,
};

export const ACTORS = [
  {
    id: 1,
    gameID: 101,
    name: 'Alice',
    server: 'Realm',
    type: 'Player',
    subType: 'Paladin',
    icon: 'Paladin-Retribution',
    petOwner: null,
  },
  {
    id: 2,
    gameID: 102,
    name: 'Bob',
    server: 'Realm',
    type: 'Player',
    subType: 'Priest',
    icon: 'Priest-Holy',
    petOwner: null,
  },
];

export function tokenResponse(token = 'token'): Response {
  return jsonResponse({ access_token: token, expires_in: 3600 });
}

export function fightsResponse(fights = [FIGHT]): Response {
  return jsonResponse({ data: { reportData: { report: { fights } } } });
}

export function playersResponse(): Response {
  return jsonResponse({
    data: {
      reportData: {
        report: {
          masterData: { actors: ACTORS },
          fights: [
            {
              id: FIGHT.id,
              friendlyPlayers: FIGHT.friendlyPlayers,
              friendlySpecs: FIGHT.friendlySpecs,
              friendlyItemLevels: FIGHT.friendlyItemLevels,
            },
          ],
        },
      },
    },
  });
}
