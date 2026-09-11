import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DEFAULT_EVENT_LIMIT,
  DEFAULT_EVENT_MAX_BYTES,
  DEFAULT_EVENT_MAX_PAGES,
  DEFAULT_EVENT_PAGE_SIZE,
  DEFAULT_TABLE_MAX_BYTES,
  DEFAULT_TABLE_MAX_ENTRIES,
  MAX_EVENT_LIMIT,
  MAX_EVENT_MAX_BYTES,
  MAX_EVENT_MAX_PAGES,
  MAX_EVENT_PAGE_SIZE,
  MAX_TABLE_MAX_BYTES,
  MAX_TABLE_MAX_ENTRIES,
  MIN_EVENT_LIMIT,
  MIN_EVENT_PAGE_SIZE,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from './constants.js';
import { errorToJson, jsonDetail } from './errors.js';
import { WclService } from './service.js';
import { EVENT_DATA_TYPES, type JsonObject, type JsonValue, type TableDataType } from './types.js';
import { parseWclUrl } from './url.js';

const regionSchema = z
  .enum(['global', 'cn'])
  .optional()
  .describe('API region for a bare report code. Full URLs select their own region.');
const reportSchema = z
  .string()
  .min(1)
  .describe('A 16-character report code or supported report URL.');
const fightSchema = z
  .union([z.number().int().positive(), z.literal('last')])
  .optional()
  .describe('Fight ID, or "last". A selector in the report URL is used when omitted.');
const translateSchema = z.boolean().optional().default(true);
const accessModeSchema = z
  .enum(['auto', 'public', 'user'])
  .optional()
  .default('auto')
  .describe('auto uses user authorization when available; user requires it; public never uses it.');
const serverRegionSchema = z.enum(['us', 'eu', 'kr', 'tw', 'cn']);
const encounterMetricSchema = z.enum([
  'default',
  'dps',
  'hps',
  'bossdps',
  'playerscore',
  'playerspeed',
  'tankhps',
  'wdps',
]);
const zoneMetricSchema = z.union([
  encounterMetricSchema,
  z.enum(['points_and_damage', 'points_and_healing']),
]);
const optionalCharacterShape = {
  name: z.string().min(1).optional(),
  server: z.string().min(1).optional().describe('Realm name or WCL server slug.'),
  serverRegion: serverRegionSchema.optional(),
};
const characterHistorySchema = z.object({
  ...optionalCharacterShape,
  accessMode: accessModeSchema,
  contentType: z.enum(['all', 'raid', 'mythicplus']).optional().default('all'),
  limitReports: z.number().int().min(1).max(10).optional().default(5),
  maxEntries: z.number().int().min(1).max(200).optional().default(100),
  maxPayloadBytes: z
    .number()
    .int()
    .min(100_000)
    .max(MAX_EVENT_MAX_BYTES)
    .optional()
    .default(600_000),
});

const commonFightShape = {
  report: reportSchema,
  region: regionSchema,
  fightID: fightSchema,
  translate: translateSchema,
  accessMode: accessModeSchema,
};

const tableInputSchema = z.object({
  ...commonFightShape,
  playerID: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Player report actor ID. The tool maps it to the correct source/target filter.'),
  abilityID: z.number().int().positive().optional(),
  startTime: z
    .number()
    .nonnegative()
    .optional()
    .describe('Relative report timestamp in milliseconds.'),
  endTime: z.number().positive().optional().describe('Relative report timestamp in milliseconds.'),
  maxEntries: z
    .number()
    .int()
    .min(1)
    .max(MAX_TABLE_MAX_ENTRIES)
    .optional()
    .default(DEFAULT_TABLE_MAX_ENTRIES),
  maxPayloadBytes: z
    .number()
    .int()
    .min(10_000)
    .max(MAX_TABLE_MAX_BYTES)
    .optional()
    .default(DEFAULT_TABLE_MAX_BYTES),
});

const eventInputSchema = z.object({
  ...commonFightShape,
  dataType: z.enum(EVENT_DATA_TYPES).optional().default('All'),
  sourceID: z.number().int().positive().optional(),
  targetID: z.number().int().positive().optional(),
  abilityID: z.number().int().positive().optional(),
  startTime: z
    .number()
    .nonnegative()
    .optional()
    .describe('Relative report timestamp in milliseconds.'),
  endTime: z.number().positive().optional().describe('Relative report timestamp in milliseconds.'),
  cursor: z
    .number()
    .nonnegative()
    .optional()
    .describe('nextPageTimestamp returned by an earlier call.'),
  includeResources: z.boolean().optional().default(false),
  maxEvents: z
    .number()
    .int()
    .min(MIN_EVENT_LIMIT)
    .max(MAX_EVENT_LIMIT)
    .optional()
    .default(DEFAULT_EVENT_LIMIT),
  pageSize: z
    .number()
    .int()
    .min(MIN_EVENT_PAGE_SIZE)
    .max(MAX_EVENT_PAGE_SIZE)
    .optional()
    .default(DEFAULT_EVENT_PAGE_SIZE),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(MAX_EVENT_MAX_PAGES)
    .optional()
    .default(DEFAULT_EVENT_MAX_PAGES),
  maxPayloadBytes: z
    .number()
    .int()
    .min(10_000)
    .max(MAX_EVENT_MAX_BYTES)
    .optional()
    .default(DEFAULT_EVENT_MAX_BYTES),
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const localWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const statefulOpenWorldAnnotations = {
  ...localWriteAnnotations,
  openWorldHint: true,
} as const;

function asObject(value: unknown): JsonObject {
  const json = jsonDetail(value);
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : { value: json };
}

function toolSuccess(value: unknown) {
  const structuredContent = asObject(value);
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Structured Warcraft Logs evidence is available in structuredContent.',
      },
    ],
    structuredContent,
  };
}

function toolFailure(error: unknown) {
  const structuredContent = { error: errorToJson(error) };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

async function execute(request: () => unknown) {
  try {
    return toolSuccess(await request());
  } catch (error) {
    return toolFailure(error);
  }
}

type TableSemantics = 'source' | 'target';

function tableFilter(
  playerID: number | undefined,
  semantics: TableSemantics,
  args: {
    abilityID?: number | undefined;
    startTime?: number | undefined;
    endTime?: number | undefined;
    translate: boolean;
  },
) {
  return {
    ...(playerID === undefined
      ? {}
      : semantics === 'source'
        ? { sourceID: playerID }
        : { targetID: playerID }),
    ...(args.abilityID === undefined ? {} : { abilityID: args.abilityID }),
    ...(args.startTime === undefined ? {} : { startTime: args.startTime }),
    ...(args.endTime === undefined ? {} : { endTime: args.endTime }),
    viewBy: playerID === undefined ? (semantics === 'source' ? 'Source' : 'Target') : 'Ability',
    translate: args.translate,
  } as const;
}

function registerTableTool(
  server: McpServer,
  service: WclService,
  name: string,
  title: string,
  description: string,
  dataType: TableDataType,
  semantics: TableSemantics,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: tableInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getTable(args.report, dataType, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
          filter: tableFilter(args.playerID, semantics, args),
          maxEntries: args.maxEntries,
          maxPayloadBytes: args.maxPayloadBytes,
        }),
      ),
  );
}

export function createServer(service: WclService): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      instructions:
        'For report URLs, list fights and players, then prefer get_fight_summary, get_mythic_plus_summary, or get_player_analysis_context. For character-first work, set an active character and use recent reports. Character subscriptions are pull-based and require periodic checks. Use accessMode=user for private data and get_events only for narrow evidence windows. The server returns evidence, not class-specific combat judgments.',
    },
  );

  server.registerTool(
    'parse_wcl_url',
    {
      title: 'Parse Warcraft Logs URL',
      description:
        'Safely parse a www.warcraftlogs.com or cn.warcraftlogs.com report URL, including query/hash fight selectors. Rejects look-alike hosts and unsafe URL forms.',
      inputSchema: z.object({ url: z.url() }),
      annotations: readOnlyAnnotations,
    },
    async ({ url }) => execute(() => parseWclUrl(url)),
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get report metadata',
      description: 'Get bounded report metadata, visibility, zone, timestamps, and archive status.',
      inputSchema: z.object({
        report: reportSchema,
        region: regionSchema,
        allowUnlisted: z.boolean().optional().default(true),
        accessMode: accessModeSchema,
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getReport(args.report, {
          region: args.region,
          allowUnlisted: args.allowUnlisted,
          accessMode: args.accessMode,
        }),
      ),
  );

  server.registerTool(
    'list_fights',
    {
      title: 'List report fights',
      description:
        'List fights with raid and Mythic+ metadata. If a fight selector is present, selectedFightID identifies it.',
      inputSchema: z.object(commonFightShape),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.listFights(args.report, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  server.registerTool(
    'list_players',
    {
      title: 'List report players',
      description:
        'List player actor IDs and map their observed specs and item levels to fights. A fight selector narrows participants.',
      inputSchema: z.object(commonFightShape),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.listPlayers(args.report, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  server.registerTool(
    'list_dungeon_pulls',
    {
      title: 'List dungeon pulls',
      description:
        'List Mythic+ pull windows, locations, map IDs, and participating enemy NPC IDs.',
      inputSchema: z.object(commonFightShape),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.listDungeonPulls(args.report, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  server.registerTool(
    'get_talent_import_code',
    {
      title: 'Get talent import code',
      description: 'Get the Retail talent import string WCL recorded for one player in one fight.',
      inputSchema: z.object({
        ...commonFightShape,
        actorID: z.number().int().positive(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getTalentImportCode(args.report, args.actorID, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  registerTableTool(
    server,
    service,
    'get_damage_done',
    'Get damage done',
    'Get bounded damage-done evidence. playerID is correctly applied as WCL sourceID.',
    'DamageDone',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_damage_taken',
    'Get damage taken',
    'Get bounded damage-taken evidence. WCL table semantics require playerID as sourceID for the selected player perspective.',
    'DamageTaken',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_casts',
    'Get casts',
    'Get bounded cast evidence. playerID is correctly applied as WCL sourceID.',
    'Casts',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_interrupts',
    'Get interrupts',
    'Get bounded interrupt evidence. playerID is correctly applied as WCL sourceID.',
    'Interrupts',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_deaths',
    'Get deaths',
    'Get bounded death evidence. WCL table semantics require playerID as sourceID for the selected player perspective.',
    'Deaths',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_buffs',
    'Get buffs',
    'Get bounded buff-uptime evidence on a player. playerID is correctly applied as WCL targetID.',
    'Buffs',
    'target',
  );
  registerTableTool(
    server,
    service,
    'get_debuffs',
    'Get debuffs',
    'Get bounded debuff evidence on a player. playerID is correctly applied as WCL targetID.',
    'Debuffs',
    'target',
  );
  registerTableTool(
    server,
    service,
    'get_dispels',
    'Get dispels',
    'Get bounded dispel evidence. playerID is correctly applied as WCL sourceID.',
    'Dispels',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_healing',
    'Get healing',
    'Get bounded healing evidence. playerID is correctly applied as WCL sourceID.',
    'Healing',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_resources',
    'Get resources',
    'Get bounded resource evidence. playerID is correctly applied as WCL sourceID.',
    'Resources',
    'source',
  );

  server.registerTool(
    'get_combatant_info',
    {
      title: 'Get combatant info',
      description:
        'Get bounded CombatantInfo events (gear, talents and player state) for one player source.',
      inputSchema: z.object({
        ...commonFightShape,
        playerID: z.number().int().positive(),
        maxPayloadBytes: z
          .number()
          .int()
          .min(10_000)
          .max(MAX_EVENT_MAX_BYTES)
          .optional()
          .default(200_000),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getEvents(
          args.report,
          {
            dataType: 'CombatantInfo',
            sourceID: args.playerID,
            maxEvents: 100,
            pageSize: 100,
            maxPages: 1,
            maxPayloadBytes: args.maxPayloadBytes,
            translate: args.translate,
          },
          {
            region: args.region,
            fight: args.fightID,
            translate: args.translate,
            accessMode: args.accessMode,
          },
        ),
      ),
  );

  server.registerTool(
    'get_events',
    {
      title: 'Get bounded combat events',
      description:
        'Get a bounded event window with WCL pagination. Enforces fight time bounds, max events/pages, and a byte budget. Continue using pagination.nextPageTimestamp as cursor.',
      inputSchema: eventInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getEvents(
          args.report,
          {
            dataType: args.dataType,
            sourceID: args.sourceID,
            targetID: args.targetID,
            abilityID: args.abilityID,
            startTime: args.startTime,
            endTime: args.endTime,
            cursor: args.cursor,
            includeResources: args.includeResources,
            translate: args.translate,
            maxEvents: args.maxEvents,
            pageSize: args.pageSize,
            maxPages: args.maxPages,
            maxPayloadBytes: args.maxPayloadBytes,
          },
          {
            region: args.region,
            fight: args.fightID,
            translate: args.translate,
            accessMode: args.accessMode,
          },
        ),
      ),
  );

  server.registerTool(
    'get_mythic_plus_summary',
    {
      title: 'Get Mythic+ summary',
      description:
        'Get a compact Mythic+ overview: key, duration, dungeon, enemy forces, players, DPS/HPS, deaths and interrupts. Optional tables fail independently with warnings.',
      inputSchema: z.object(commonFightShape),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getMythicPlusSummary(args.report, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  server.registerTool(
    'get_player_analysis_context',
    {
      title: 'Get player analysis context',
      description:
        'Aggregate bounded damage, casts, damage taken, interrupts, deaths, buffs, resources, CombatantInfo and talent evidence for one player. Components fail independently and return warnings.',
      inputSchema: z.object({
        ...commonFightShape,
        player: z.union([z.number().int().positive(), z.string().min(1)]),
        maxEntries: z.number().int().min(1).max(200).optional().default(100),
        maxPayloadBytes: z
          .number()
          .int()
          .min(100_000)
          .max(MAX_EVENT_MAX_BYTES)
          .optional()
          .default(600_000),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getPlayerAnalysisContext(args.report, args.player, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
          maxEntries: args.maxEntries,
          maxPayloadBytes: args.maxPayloadBytes,
        }),
      ),
  );

  server.registerTool(
    'set_active_character',
    {
      title: 'Set active character',
      description:
        'Validate and persist the default character used by character discovery and ranking tools.',
      inputSchema: z.object({
        name: z.string().min(1),
        server: z.string().min(1).describe('Realm name or WCL server slug.'),
        serverRegion: serverRegionSchema,
      }),
      annotations: statefulOpenWorldAnnotations,
    },
    async (args) =>
      execute(() => service.setActiveCharacter(args.name, args.server, args.serverRegion)),
  );

  server.registerTool(
    'get_active_character',
    {
      title: 'Get active character',
      description: 'Return the locally persisted active character, if one is configured.',
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => execute(() => ({ activeCharacter: service.getActiveCharacter() })),
  );

  server.registerTool(
    'clear_active_character',
    {
      title: 'Clear active character',
      description: 'Remove the locally persisted active-character default.',
      inputSchema: z.object({}),
      annotations: { ...localWriteAnnotations, destructiveHint: true },
    },
    async () => execute(() => service.clearActiveCharacter()),
  );

  server.registerTool(
    'get_character_summary',
    {
      title: 'Get character summary',
      description:
        'Resolve a character and summarize its recent report availability and content types. Omit all identity fields to use the active character.',
      inputSchema: z.object({ ...optionalCharacterShape, accessMode: accessModeSchema }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getCharacterSummary(
          { name: args.name, server: args.server, serverRegion: args.serverRegion },
          { accessMode: args.accessMode },
        ),
      ),
  );

  server.registerTool(
    'get_recent_reports',
    {
      title: 'Get recent character reports',
      description:
        'List recent reports for a character, including report visibility and bounded fight metadata. User access can include private reports visible to the authorized WCL account.',
      inputSchema: z.object({
        ...optionalCharacterShape,
        accessMode: accessModeSchema,
        limit: z.number().int().min(1).max(100).optional().default(10),
        page: z.number().int().positive().optional().default(1),
        contentType: z.enum(['all', 'raid', 'mythicplus']).optional().default('all'),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getRecentReports(
          { name: args.name, server: args.server, serverRegion: args.serverRegion },
          {
            accessMode: args.accessMode,
            limit: args.limit,
            page: args.page,
            contentType: args.contentType,
          },
        ),
      ),
  );

  server.registerTool(
    'get_encounter_rankings',
    {
      title: 'Get character encounter rankings',
      description:
        'Get WCL rankings for one character and exactly one encounter or zone. Private parses require user authorization and includePrivateLogs=true.',
      inputSchema: z
        .object({
          ...optionalCharacterShape,
          accessMode: accessModeSchema,
          encounterID: z.number().int().positive().optional(),
          zoneID: z.number().int().positive().optional(),
          difficulty: z.number().int().positive().optional(),
          metric: zoneMetricSchema.optional(),
          includePrivateLogs: z.boolean().optional().default(false),
        })
        .refine((value) => (value.encounterID === undefined) !== (value.zoneID === undefined), {
          message: 'Provide exactly one of encounterID or zoneID.',
        })
        .refine(
          (value) =>
            value.encounterID === undefined ||
            value.metric === undefined ||
            value.metric === 'default' ||
            encounterMetricSchema.safeParse(value.metric).success,
          { message: 'points_and_damage and points_and_healing are zone-only metrics.' },
        ),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getEncounterRankings(
          { name: args.name, server: args.server, serverRegion: args.serverRegion },
          {
            accessMode: args.accessMode,
            encounterID: args.encounterID,
            zoneID: args.zoneID,
            difficulty: args.difficulty,
            metric: args.metric,
            includePrivateLogs: args.includePrivateLogs,
          },
        ),
      ),
  );

  server.registerTool(
    'subscribe_character',
    {
      title: 'Subscribe to character reports',
      description:
        'Persist a pull-based subscription. By default current reports become the baseline, so later checks return only newly discovered reports.',
      inputSchema: z.object({
        name: z.string().min(1),
        server: z.string().min(1),
        serverRegion: serverRegionSchema,
        accessMode: accessModeSchema,
        includeExisting: z.boolean().optional().default(false),
      }),
      annotations: statefulOpenWorldAnnotations,
    },
    async (args) =>
      execute(() =>
        service.subscribeCharacter(args.name, args.server, args.serverRegion, {
          accessMode: args.accessMode,
          includeExisting: args.includeExisting,
        }),
      ),
  );

  server.registerTool(
    'list_character_subscriptions',
    {
      title: 'List character subscriptions',
      description: 'List locally persisted character report subscriptions and their cursors.',
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => execute(() => service.listCharacterSubscriptions()),
  );

  server.registerTool(
    'check_character_subscriptions',
    {
      title: 'Check character subscriptions',
      description:
        'Poll WCL for new reports and advance subscription cursors. Omit subscriptionID to check all subscriptions.',
      inputSchema: z.object({ subscriptionID: z.uuid().optional() }),
      annotations: statefulOpenWorldAnnotations,
    },
    async (args) => execute(() => service.checkCharacterSubscriptions(args.subscriptionID)),
  );

  server.registerTool(
    'unsubscribe_character',
    {
      title: 'Unsubscribe from character reports',
      description: 'Delete one locally persisted character report subscription.',
      inputSchema: z.object({ subscriptionID: z.uuid() }),
      annotations: { ...localWriteAnnotations, destructiveHint: true },
    },
    async (args) => execute(() => service.unsubscribeCharacter(args.subscriptionID)),
  );

  server.registerTool(
    'get_fight_summary',
    {
      title: 'Get fight summary',
      description:
        'Get a compact raid or Mythic+ fight summary with player damage, healing, deaths, interrupts, and fight metadata.',
      inputSchema: z.object(commonFightShape),
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getFightSummary(args.report, {
          region: args.region,
          fight: args.fightID,
          translate: args.translate,
          accessMode: args.accessMode,
        }),
      ),
  );

  registerTableTool(
    server,
    service,
    'get_fight_damage',
    'Get fight damage',
    'Compatibility alias for get_damage_done with bounded source semantics.',
    'DamageDone',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_fight_healing',
    'Get fight healing',
    'Compatibility alias for get_healing with bounded source semantics.',
    'Healing',
    'source',
  );
  registerTableTool(
    server,
    service,
    'get_fight_damage_taken',
    'Get fight damage taken',
    'Compatibility alias for get_damage_taken with bounded WCL player/source semantics.',
    'DamageTaken',
    'source',
  );
  server.registerTool(
    'get_character_deaths',
    {
      title: 'Get character death history',
      description:
        'Discover recent reports and return bounded, best-effort death evidence for one character across those reports.',
      inputSchema: characterHistorySchema,
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getCharacterDeaths(
          { name: args.name, server: args.server, serverRegion: args.serverRegion },
          {
            accessMode: args.accessMode,
            contentType: args.contentType,
            limitReports: args.limitReports,
            maxEntries: args.maxEntries,
            maxPayloadBytes: args.maxPayloadBytes,
          },
        ),
      ),
  );
  server.registerTool(
    'get_character_casts',
    {
      title: 'Get character cast history',
      description:
        'Discover recent reports and return bounded, best-effort cast evidence for one character across those reports.',
      inputSchema: characterHistorySchema,
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getCharacterCasts(
          { name: args.name, server: args.server, serverRegion: args.serverRegion },
          {
            accessMode: args.accessMode,
            contentType: args.contentType,
            limitReports: args.limitReports,
            maxEntries: args.maxEntries,
            maxPayloadBytes: args.maxPayloadBytes,
          },
        ),
      ),
  );
  registerTableTool(
    server,
    service,
    'get_buff_uptime',
    'Get buff uptime',
    'Compatibility alias for get_buffs with bounded target semantics.',
    'Buffs',
    'target',
  );

  server.registerTool(
    'get_fight_events',
    {
      title: 'Get fight events',
      description:
        'Compatibility alias for get_events with full pagination, time-window, event-count, page-count, and byte protections.',
      inputSchema: eventInputSchema,
      annotations: readOnlyAnnotations,
    },
    async (args) =>
      execute(() =>
        service.getEvents(
          args.report,
          {
            dataType: args.dataType,
            sourceID: args.sourceID,
            targetID: args.targetID,
            abilityID: args.abilityID,
            startTime: args.startTime,
            endTime: args.endTime,
            cursor: args.cursor,
            includeResources: args.includeResources,
            translate: args.translate,
            maxEvents: args.maxEvents,
            pageSize: args.pageSize,
            maxPages: args.maxPages,
            maxPayloadBytes: args.maxPayloadBytes,
          },
          {
            region: args.region,
            fight: args.fightID,
            translate: args.translate,
            accessMode: args.accessMode,
          },
        ),
      ),
  );

  return server;
}

export type McpJson = JsonValue;
