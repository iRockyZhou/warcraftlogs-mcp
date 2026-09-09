import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WclClient } from '../src/client.js';
import { WclService } from '../src/service.js';
import { WclStateStore } from '../src/storage.js';
import type { FetchLike } from '../src/types.js';
import { TEST_CONFIG, jsonResponse, tokenResponse } from './helpers.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'warcraftlogs-mcp-character-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const PROFILE = {
  id: 7,
  canonicalID: 70,
  name: 'Alice',
  classID: 2,
  level: 80,
  hidden: false,
  faction: { id: 1, name: 'Alliance' },
  server: {
    id: 11,
    name: 'Area 52',
    normalizedName: 'Area 52',
    slug: 'area-52',
    region: { id: 1, name: 'United States', compactName: 'US', slug: 'us' },
  },
  guilds: [{ id: 90, name: 'Test Guild' }],
};

function report(code: string, startTime: number, visibility = 'public') {
  return {
    code,
    title: `Report ${code}`,
    startTime,
    endTime: startTime + 10_000,
    visibility,
    owner: { name: 'Uploader' },
    zone: { id: 42, name: 'Test Zone' },
    fights: [
      {
        id: 1,
        name: 'Test Fight',
        startTime: 0,
        endTime: 10_000,
        kill: true,
        difficulty: 10,
        fightPercentage: 0,
        keystoneLevel: 10,
      },
    ],
  };
}

function characterResponse(): Response {
  return jsonResponse({ data: { characterData: { character: PROFILE } } });
}

function recentReportsResponse(reports: unknown[]): Response {
  return jsonResponse({
    data: {
      characterData: {
        character: {
          ...PROFILE,
          recentReports: {
            total: reports.length,
            per_page: 100,
            current_page: 1,
            last_page: 1,
            has_more_pages: false,
            data: reports,
          },
        },
      },
    },
  });
}

describe('character discovery and subscriptions', () => {
  it('persists an active character and uses it as the discovery default', async () => {
    const directory = await temporaryDirectory();
    const responses = [
      tokenResponse(),
      characterResponse(),
      recentReportsResponse([report('public-a', 1_000)]),
    ];
    const fetcher: FetchLike = () => {
      const response = responses.shift();
      if (response === undefined) throw new Error('No queued response');
      return Promise.resolve(response);
    };
    const service = new WclService(
      new WclClient(TEST_CONFIG, { fetcher }),
      new WclStateStore(directory),
    );

    await service.setActiveCharacter('alice', 'Area 52', 'US');
    const result = await service.getRecentReports();

    expect(service.getActiveCharacter()).toEqual({
      name: 'Alice',
      serverSlug: 'area-52',
      serverRegion: 'us',
      apiRegion: 'global',
    });
    expect(result.reports.map((entry) => entry.code)).toEqual(['public-a']);
  });

  it('returns only newly discovered reports and advances the subscription cursor', async () => {
    const directory = await temporaryDirectory();
    let recentCalls = 0;
    const requestUrls: string[] = [];
    const fetcher: FetchLike = (input, init) => {
      requestUrls.push(String(input));
      if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body');
      const body = JSON.parse(init.body) as { query: string };
      if (body.query.includes('GetCharacter')) return Promise.resolve(characterResponse());
      if (body.query.includes('GetRecentReports')) {
        recentCalls += 1;
        return Promise.resolve(
          recentReportsResponse(
            recentCalls === 1
              ? [report('old-report', 1_000, 'private')]
              : [report('new-report', 2_000, 'private'), report('old-report', 1_000, 'private')],
          ),
        );
      }
      throw new Error('Unexpected GraphQL query');
    };
    const config = { ...TEST_CONFIG, userAccessTokens: { global: 'user-token' } };
    const service = new WclService(
      new WclClient(config, { fetcher }),
      new WclStateStore(directory),
    );

    const subscribed = await service.subscribeCharacter('alice', 'Area 52', 'us');
    const checked = await service.checkCharacterSubscriptions(subscribed.subscription.id);
    const checkedAgain = await service.checkCharacterSubscriptions(subscribed.subscription.id);

    expect(checked.newReportCount).toBe(1);
    expect(subscribed.subscription.accessMode).toBe('user');
    expect(checked.results[0]?.newReports.map((entry) => entry.code)).toEqual(['new-report']);
    expect(checkedAgain.newReportCount).toBe(0);
    expect(requestUrls).toHaveLength(4);
    expect(requestUrls.every((url) => url.endsWith('/api/v2/user'))).toBe(true);
  });

  it('supports both encounter and zone ranking queries with exclusive selectors', async () => {
    const directory = await temporaryDirectory();
    const operations: string[] = [];
    const fetcher: FetchLike = (input, init) => {
      if (String(input).endsWith('/oauth/token')) return Promise.resolve(tokenResponse());
      if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body');
      const body = JSON.parse(init.body) as { query: string };
      operations.push(body.query);
      return Promise.resolve(
        jsonResponse({
          data: {
            characterData: {
              character: body.query.includes('ZoneRankings')
                ? { zoneRankings: { bestPerformanceAverage: 95 } }
                : { encounterRankings: { rankPercent: 90 } },
            },
          },
        }),
      );
    };
    const service = new WclService(
      new WclClient(TEST_CONFIG, { fetcher }),
      new WclStateStore(directory),
    );
    const identity = { name: 'Alice', server: 'Area 52', serverRegion: 'us' };

    await expect(service.getEncounterRankings(identity, { zoneID: 42 })).resolves.toMatchObject({
      type: 'zone',
      zoneID: 42,
      rankings: { bestPerformanceAverage: 95 },
    });
    await expect(service.getEncounterRankings(identity, { encounterID: 7 })).resolves.toMatchObject(
      {
        type: 'encounter',
        encounterID: 7,
        rankings: { rankPercent: 90 },
      },
    );
    await expect(service.getEncounterRankings(identity, {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(operations).toHaveLength(2);
  });
});
