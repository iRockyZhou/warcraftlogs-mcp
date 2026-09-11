import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { WclClient } from '../src/client.js';
import { createServer } from '../src/server.js';
import { WclService } from '../src/service.js';
import type { FetchLike } from '../src/types.js';
import { TEST_CONFIG, fightsResponse, jsonResponse, tokenResponse } from './helpers.js';

const CODE = 'gDBTZr6pz1AvnxbW';

describe('MCP mock integration', () => {
  it('lists every product tool and applies source/target semantics in table wrappers', async () => {
    const tableVariables: Record<string, unknown>[] = [];
    const fetcher: FetchLike = (input, init) => {
      if (String(input).endsWith('/oauth/token')) return Promise.resolve(tokenResponse());
      if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body');
      const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes('ListFights')) return Promise.resolve(fightsResponse());
      if (body.query.includes('GetReportTable')) {
        tableVariables.push(body.variables);
        return Promise.resolve(
          jsonResponse({
            data: { reportData: { report: { table: { data: { entries: [] } } } } },
          }),
        );
      }
      throw new Error('Unexpected query');
    };
    const service = new WclService(
      new WclClient(TEST_CONFIG, { fetcher, sleep: () => Promise.resolve() }),
    );
    const server = createServer(service);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        [
          'parse_wcl_url',
          'get_report',
          'list_fights',
          'list_players',
          'list_dungeon_pulls',
          'get_talent_import_code',
          'get_damage_done',
          'get_damage_taken',
          'get_casts',
          'get_interrupts',
          'get_deaths',
          'get_buffs',
          'get_debuffs',
          'get_dispels',
          'get_healing',
          'get_resources',
          'get_combatant_info',
          'get_events',
          'get_mythic_plus_summary',
          'get_player_analysis_context',
          'set_active_character',
          'get_active_character',
          'clear_active_character',
          'get_character_summary',
          'get_recent_reports',
          'get_encounter_rankings',
          'subscribe_character',
          'list_character_subscriptions',
          'check_character_subscriptions',
          'unsubscribe_character',
          'get_fight_summary',
          'get_fight_damage',
          'get_fight_healing',
          'get_fight_damage_taken',
          'get_character_deaths',
          'get_character_casts',
          'get_buff_uptime',
          'get_fight_events',
        ].sort(),
      );

      const semantics = [
        ['get_damage_done', 'sourceID'],
        ['get_damage_taken', 'sourceID'],
        ['get_casts', 'sourceID'],
        ['get_interrupts', 'sourceID'],
        ['get_deaths', 'sourceID'],
        ['get_buffs', 'targetID'],
        ['get_debuffs', 'targetID'],
        ['get_dispels', 'sourceID'],
        ['get_healing', 'sourceID'],
        ['get_resources', 'sourceID'],
        ['get_fight_damage', 'sourceID'],
        ['get_fight_healing', 'sourceID'],
        ['get_fight_damage_taken', 'sourceID'],
        ['get_buff_uptime', 'targetID'],
      ] as const;

      for (const [name, expectedFilter] of semantics) {
        const result = await client.callTool({
          name,
          arguments: { report: CODE, fightID: 1, playerID: 7 },
        });
        expect(result.content).toEqual([
          {
            type: 'text',
            text: 'Structured Warcraft Logs evidence is available in structuredContent.',
          },
        ]);
        const variables = tableVariables.at(-1);
        expect(variables).toHaveProperty(expectedFilter, 7);
        expect(variables).toHaveProperty('allowUnlisted', true);
        expect(variables).not.toHaveProperty(
          expectedFilter === 'sourceID' ? 'targetID' : 'sourceID',
        );
      }
      expect(tableVariables).toHaveLength(semantics.length);

      const privateWithoutAuthorization = await client.callTool({
        name: 'list_fights',
        arguments: { report: CODE, fightID: 1, accessMode: 'user' },
      });
      expect(privateWithoutAuthorization.isError).toBe(true);
      expect(privateWithoutAuthorization.structuredContent).toMatchObject({
        error: {
          code: 'USER_AUTH_REQUIRED',
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
