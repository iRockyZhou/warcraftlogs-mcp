import { describe, expect, it } from 'vitest';
import { WclClient } from '../src/client.js';
import { WclService } from '../src/service.js';
import type { FetchLike } from '../src/types.js';
import {
  TEST_CONFIG,
  fightsResponse,
  jsonResponse,
  playersResponse,
  tokenResponse,
} from './helpers.js';

const CODE = 'gDBTZr6pz1AvnxbW';

type Route = (query: string, variables: Record<string, unknown>) => Response;

function routedService(route: Route): WclService {
  const fetcher: FetchLike = (input, init) => {
    if (String(input).endsWith('/oauth/token')) return Promise.resolve(tokenResponse());
    if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body');
    const body: unknown = JSON.parse(init.body);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Expected GraphQL object');
    }
    const query = 'query' in body && typeof body.query === 'string' ? body.query : '';
    const variables =
      'variables' in body &&
      typeof body.variables === 'object' &&
      body.variables !== null &&
      !Array.isArray(body.variables)
        ? (body.variables as Record<string, unknown>)
        : {};
    return Promise.resolve(route(query, variables));
  };
  return new WclService(new WclClient(TEST_CONFIG, { fetcher, sleep: () => Promise.resolve() }));
}

function tableResponse(entries: unknown[]): Response {
  return jsonResponse({
    data: { reportData: { report: { table: { data: { entries, totalTime: 10_000 } } } } },
  });
}

describe('WclService mock integration', () => {
  it('reads private report metadata through the user GraphQL endpoint', async () => {
    const urls: string[] = [];
    const fetcher: FetchLike = (input, init) => {
      urls.push(String(input));
      if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body');
      const body = JSON.parse(init.body) as { variables: Record<string, unknown> };
      expect(body.variables).toMatchObject({ code: CODE, allowUnlisted: true });
      return Promise.resolve(
        jsonResponse({
          data: {
            reportData: {
              report: {
                code: CODE,
                title: 'Private report',
                startTime: 1,
                endTime: 2,
                visibility: 'private',
                revision: 1,
                segments: 1,
                exportedSegments: 1,
                zone: null,
                archiveStatus: null,
              },
            },
          },
        }),
      );
    };
    const service = new WclService(
      new WclClient(
        { ...TEST_CONFIG, userAccessTokens: { global: 'authorized-user-token' } },
        { fetcher },
      ),
    );

    await expect(service.getReport(CODE, { accessMode: 'user' })).resolves.toMatchObject({
      report: { visibility: 'private' },
    });
    expect(urls).toEqual(['https://www.warcraftlogs.com/api/v2/user']);
  });

  it('allows a directly supplied unlisted report code by default', async () => {
    let variables: Record<string, unknown> = {};
    const service = routedService((query, value) => {
      if (!query.includes('GetReport')) throw new Error('Unexpected query');
      variables = value;
      return jsonResponse({
        data: {
          reportData: {
            report: {
              code: CODE,
              title: 'Unlisted report',
              startTime: 1,
              endTime: 2,
              visibility: 'unlisted',
              revision: 1,
              segments: 1,
              exportedSegments: 1,
              zone: null,
              archiveStatus: null,
            },
          },
        },
      });
    });

    await expect(service.getReport(CODE)).resolves.toMatchObject({
      report: { visibility: 'unlisted' },
    });
    expect(variables).toMatchObject({ code: CODE, allowUnlisted: true });
  });

  it('paginates events without exceeding the event limit', async () => {
    const cursors: number[] = [];
    const service = routedService((query, variables) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('GetReportEvents')) {
        const start = Number(variables['startTime']);
        cursors.push(start);
        const base = start === 0 ? 0 : 100;
        const events = Array.from({ length: 100 }, (_, index) => ({
          timestamp: start + index,
          type: 'damage',
          amount: base + index,
        }));
        return jsonResponse({
          data: {
            reportData: {
              report: { events: { data: events, nextPageTimestamp: start === 0 ? 5_000 : null } },
            },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getEvents(
      CODE,
      {
        dataType: 'DamageDone',
        maxEvents: 200,
        pageSize: 100,
        maxPages: 3,
        maxPayloadBytes: 1_000_000,
      },
      { fight: 1 },
    );
    expect(result.events).toHaveLength(200);
    expect(result.pagination).toMatchObject({
      pagesFetched: 2,
      nextPageTimestamp: null,
      stopReason: 'complete',
    });
    expect(cursors).toEqual([0, 5_000]);
  });

  it("supports a small consumer limit while honoring WCL's 100-event page minimum", async () => {
    const requestedLimits: number[] = [];
    const service = routedService((query, variables) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('GetReportEvents')) {
        requestedLimits.push(Number(variables['limit']));
        return jsonResponse({
          data: {
            reportData: {
              report: {
                events: {
                  data: Array.from({ length: 100 }, (_, index) => ({
                    timestamp: index,
                    type: 'cast',
                  })),
                  nextPageTimestamp: null,
                },
              },
            },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getEvents(
      CODE,
      { dataType: 'Casts', maxEvents: 10, pageSize: 100, maxPages: 1 },
      { fight: 1 },
    );
    expect(requestedLimits).toEqual([100]);
    expect(result.events).toHaveLength(10);
    expect(result.pagination).toMatchObject({
      nextPageTimestamp: 10,
      stopReason: 'maxEvents',
      cursorMayRepeat: true,
    });
  });

  it('stops before crossing the byte budget and exposes a resumable inclusive cursor', async () => {
    const service = routedService((query) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('GetReportEvents')) {
        return jsonResponse({
          data: {
            reportData: {
              report: {
                events: {
                  data: [
                    { timestamp: 100, payload: 'a'.repeat(4_500) },
                    { timestamp: 200, payload: 'b'.repeat(4_500) },
                  ],
                  nextPageTimestamp: null,
                },
              },
            },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getEvents(
      CODE,
      {
        dataType: 'All',
        maxEvents: 100,
        pageSize: 100,
        maxPages: 1,
        maxPayloadBytes: 10_000,
      },
      { fight: 1 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.pagination).toMatchObject({
      nextPageTimestamp: 200,
      stopReason: 'payloadBudget',
      cursorMayRepeat: true,
    });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(10_000);
  });

  it('transforms a Mythic+ summary with player metrics and enemy forces', async () => {
    const service = routedService((query, variables) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('ListPlayers')) return playersResponse();
      if (query.includes('GetReportTable')) {
        switch (variables['dataType']) {
          case 'DamageDone':
            return tableResponse([
              { id: 1, name: 'Alice', total: 10_000 },
              { id: 2, name: 'Bob', total: 5_000 },
            ]);
          case 'Healing':
            return tableResponse([
              { id: 1, name: 'Alice', total: 500 },
              { id: 2, name: 'Bob', total: 8_000 },
            ]);
          case 'Deaths':
            return tableResponse([
              { id: 1, name: 'Alice', timestamp: 5_000 },
              { id: 1, name: 'Alice', timestamp: 6_000 },
            ]);
          case 'Interrupts':
            return tableResponse([
              {
                entries: [
                  {
                    name: 'Chaos Bolt',
                    details: [
                      { id: 1, name: 'Alice', total: 3 },
                      { id: 2, name: 'Bob', total: 1 },
                    ],
                  },
                  { name: 'Fel Missiles', details: [{ id: 1, name: 'Alice', total: 4 }] },
                ],
              },
            ]);
          default:
            throw new Error('Unexpected table');
        }
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getMythicPlusSummary(CODE, { fight: 1 });
    expect(result).toMatchObject({
      contentType: 'mythicplus',
      location: 'Test Dungeon',
      dungeon: 'Test Dungeon',
      keyLevel: 10,
      durationMs: 10_000,
      enemyForces: { reached: 100, required: 100, percent: 100 },
      warnings: [],
    });
    expect(result.players[0]).toMatchObject({
      id: 1,
      name: 'Alice',
      totalDamage: 10_000,
      dps: 1_000,
      hps: 50,
      deaths: 2,
      interrupts: 7,
    });
    expect(result.players[1]).toMatchObject({ id: 2, name: 'Bob', deaths: 0, interrupts: 1 });
  });

  it('discovers recent reports for bounded character death and cast history', async () => {
    const tableVariables: Record<string, unknown>[] = [];
    const service = routedService((query, variables) => {
      if (query.includes('GetRecentReports')) {
        return jsonResponse({
          data: {
            characterData: {
              character: {
                id: 1,
                canonicalID: 10,
                name: 'Alice',
                classID: 2,
                level: 80,
                hidden: false,
                faction: { id: 1, name: 'Alliance' },
                server: {
                  id: 1,
                  name: 'Realm',
                  normalizedName: 'Realm',
                  slug: 'realm',
                  region: { id: 1, name: 'United States', compactName: 'US', slug: 'us' },
                },
                guilds: [],
                recentReports: {
                  total: 1,
                  per_page: 5,
                  current_page: 1,
                  last_page: 1,
                  has_more_pages: false,
                  data: [
                    {
                      code: CODE,
                      title: 'Recent run',
                      startTime: 1_000,
                      endTime: 11_000,
                      visibility: 'public',
                      owner: { name: 'Uploader' },
                      zone: { id: 42, name: 'Test Dungeon' },
                      fights: [
                        {
                          id: 1,
                          name: 'Test Dungeon',
                          startTime: 0,
                          endTime: 10_000,
                          kill: true,
                          difficulty: 10,
                          fightPercentage: 0,
                          keystoneLevel: 10,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        });
      }
      if (query.includes('ListPlayers')) return playersResponse();
      if (query.includes('GetReportTable')) {
        tableVariables.push(variables);
        return tableResponse([{ name: 'Test ability', total: 2 }]);
      }
      throw new Error('Unexpected query');
    });
    const identity = { name: 'Alice', server: 'Realm', serverRegion: 'us' };

    const deaths = await service.getCharacterDeaths(identity, { contentType: 'mythicplus' });
    const casts = await service.getCharacterCasts(identity, { contentType: 'mythicplus' });

    expect(deaths).toMatchObject({
      dataType: 'Deaths',
      sourceTargetSemantics: 'source',
      reportsScanned: 1,
      reportsReturned: 1,
      fightsAnalyzed: 1,
      warnings: [],
    });
    expect(casts).toMatchObject({
      dataType: 'Casts',
      sourceTargetSemantics: 'source',
      reportsReturned: 1,
    });
    expect(tableVariables[0]).toMatchObject({
      dataType: 'Deaths',
      fightIDs: [1],
      sourceID: 1,
      allowUnlisted: true,
    });
    expect(tableVariables[1]).toMatchObject({
      dataType: 'Casts',
      fightIDs: [1],
      sourceID: 1,
      allowUnlisted: true,
    });
  });

  it('preserves player-array alignment when WCL returns nullable spec or item-level slots', async () => {
    const service = routedService((query) => {
      if (query.includes('ListPlayers')) {
        return jsonResponse({
          data: {
            reportData: {
              report: {
                masterData: {
                  actors: [
                    {
                      id: 1,
                      gameID: 101,
                      name: 'Alice',
                      server: 'Realm',
                      type: 'Player',
                      subType: 'Paladin',
                      icon: null,
                      petOwner: null,
                    },
                    {
                      id: 2,
                      gameID: 102,
                      name: 'Bob',
                      server: 'Realm',
                      type: 'Player',
                      subType: 'Priest',
                      icon: null,
                      petOwner: null,
                    },
                  ],
                },
                fights: [
                  {
                    id: 1,
                    friendlyPlayers: [1, 2],
                    friendlySpecs: ['Retribution', null],
                    friendlyItemLevels: [301, null],
                  },
                ],
              },
            },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.listPlayers(CODE);
    expect(result.players[0]).toMatchObject({ specs: ['Retribution'], itemLevels: [301] });
    expect(result.players[1]).toMatchObject({ specs: [], itemLevels: [] });
  });

  it('returns best-effort player evidence with warnings for failed components', async () => {
    const tableVariables: Record<string, unknown>[] = [];
    const service = routedService((query, variables) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('ListPlayers')) return playersResponse();
      if (query.includes('GetReportTable')) {
        tableVariables.push(variables);
        if (variables['dataType'] === 'Buffs') {
          return jsonResponse({ data: null, errors: [{ message: 'Buff table unavailable' }] });
        }
        return tableResponse([{ id: 1, name: 'Alice', total: 10 }]);
      }
      if (query.includes('GetReportEvents')) {
        return jsonResponse({
          data: {
            reportData: {
              report: {
                events: { data: [{ timestamp: 0, sourceID: 1 }], nextPageTimestamp: null },
              },
            },
          },
        });
      }
      if (query.includes('GetTalentImportCode')) {
        return jsonResponse({
          data: {
            reportData: { report: { fights: [{ id: 1, talentImportCode: 'TALENT-CODE' }] } },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getPlayerAnalysisContext(CODE, 'alice', { fight: 1 });
    expect(result.player).toMatchObject({ id: 1, name: 'Alice' });
    expect(result.evidence).toHaveProperty('damageDone');
    expect(result.evidence).toHaveProperty('combatantInfo');
    expect(result.evidence).toHaveProperty('talentImportCode');
    expect(result.evidence).not.toHaveProperty('buffs');
    expect(result.warnings).toEqual([expect.objectContaining({ component: 'buffs' })]);
    expect(
      tableVariables.find((variables) => variables['dataType'] === 'DamageTaken'),
    ).toMatchObject({ sourceID: 1 });
    expect(tableVariables.find((variables) => variables['dataType'] === 'Deaths')).toMatchObject({
      sourceID: 1,
    });
    expect(tableVariables.find((variables) => variables['dataType'] === 'Buffs')).toMatchObject({
      targetID: 1,
    });
  });

  it('omits later analysis components before crossing the aggregate byte budget', async () => {
    const service = routedService((query) => {
      if (query.includes('ListFights')) return fightsResponse();
      if (query.includes('ListPlayers')) return playersResponse();
      if (query.includes('GetReportTable')) {
        return tableResponse([{ id: 1, name: 'Alice', payload: 'x'.repeat(60_000) }]);
      }
      if (query.includes('GetReportEvents')) {
        return jsonResponse({
          data: {
            reportData: {
              report: {
                events: {
                  data: [{ timestamp: 0, sourceID: 1, payload: 'y'.repeat(60_000) }],
                  nextPageTimestamp: null,
                },
              },
            },
          },
        });
      }
      if (query.includes('GetTalentImportCode')) {
        return jsonResponse({
          data: {
            reportData: { report: { fights: [{ id: 1, talentImportCode: 'TALENT-CODE' }] } },
          },
        });
      }
      throw new Error('Unexpected query');
    });

    const result = await service.getPlayerAnalysisContext(CODE, 'Alice', {
      fight: 1,
      maxPayloadBytes: 150_000,
    });

    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(150_000);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('maps report-not-found nulls to a stable structured error', async () => {
    const service = routedService((query) => {
      if (query.includes('GetReport')) {
        return jsonResponse({ data: { reportData: { report: null } } });
      }
      throw new Error('Unexpected query');
    });
    await expect(service.getReport(CODE)).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
  });
});
