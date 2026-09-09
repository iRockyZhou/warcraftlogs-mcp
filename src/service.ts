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
  MIN_EVENT_LIMIT,
  MAX_TABLE_MAX_BYTES,
  MAX_TABLE_MAX_ENTRIES,
  MIN_EVENT_PAGE_SIZE,
  WCL_ORIGINS,
  type WclRegion,
} from './constants.js';
import { WclError, errorToJson, jsonDetail } from './errors.js';
import { WclClient } from './client.js';
import { characterIdentity, normalizeServerSlug } from './character.js';
import {
  byteLength,
  countForEntry,
  getTableEntries,
  isJsonObject,
  normalizeTable,
  numberField,
  stringField,
} from './normalize.js';
import {
  DOCTOR_QUERY,
  GET_CHARACTER_QUERY,
  GET_DUNGEON_PULLS_QUERY,
  GET_ENCOUNTER_RANKINGS_QUERY,
  GET_EVENTS_QUERY,
  GET_RECENT_REPORTS_QUERY,
  GET_REPORT_QUERY,
  GET_TABLE_QUERY,
  GET_TALENT_IMPORT_CODE_QUERY,
  GET_ZONE_RANKINGS_QUERY,
  LIST_FIGHTS_QUERY,
  LIST_PLAYERS_QUERY,
} from './queries.js';
import {
  doctorResponseSchema,
  characterResponseSchema,
  dungeonPullsResponseSchema,
  eventsResponseSchema,
  getReportResponseSchema,
  listFightsResponseSchema,
  listPlayersResponseSchema,
  rankingResponseSchema,
  recentReportsResponseSchema,
  tableResponseSchema,
  talentResponseSchema,
} from './schemas.js';
import { WclStateStore, defaultStateDirectory } from './storage.js';
import type {
  EventPage,
  EventQuery,
  CharacterIdentity,
  CharacterProfile,
  FightSelector,
  JsonObject,
  JsonValue,
  NormalizedTable,
  PlayerSummary,
  ReportFight,
  ReportReference,
  TableDataType,
  TableFilter,
  WclConfig,
  WclAccessMode,
} from './types.js';
import { resolveReportReference } from './url.js';
import type { z } from 'zod';

type CharacterCore = NonNullable<
  z.infer<typeof characterResponseSchema>['characterData']['character']
>;

type CommonOptions = {
  region?: WclRegion | undefined;
  translate?: boolean | undefined;
  accessMode?: WclAccessMode | undefined;
};
type TableOptions = CommonOptions & {
  fight?: FightSelector | undefined;
  filter?: TableFilter | undefined;
  maxEntries?: number | undefined;
  maxPayloadBytes?: number | undefined;
};
type CharacterHistoryOptions = CommonOptions & {
  contentType?: 'all' | 'raid' | 'mythicplus' | undefined;
  limitReports?: number | undefined;
  maxEntries?: number | undefined;
  maxPayloadBytes?: number | undefined;
};

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WclError('INVALID_RESPONSE', `Warcraft Logs returned an invalid ${label} response.`, {
      details: {
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

function requireReport<T>(report: T | null, reportCode: string): T {
  if (report === null) {
    throw new WclError(
      'REPORT_NOT_FOUND',
      'The Warcraft Logs report does not exist or is not accessible.',
      {
        details: { reportCode },
      },
    );
  }
  return report;
}

function requireCharacter<T>(character: T | null, identity: CharacterIdentity): T {
  if (character === null) {
    throw new WclError('PLAYER_NOT_FOUND', 'The Warcraft Logs character was not found.', {
      details: {
        name: identity.name,
        serverSlug: identity.serverSlug,
        serverRegion: identity.serverRegion,
      },
    });
  }
  return character;
}

function assertIntegerRange(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WclError(
      'INVALID_ARGUMENT',
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function selectFight(
  fights: ReportFight[],
  selector: FightSelector | null,
  requireSelection: boolean,
): ReportFight | null {
  if (fights.length === 0) {
    throw new WclError('FIGHT_NOT_FOUND', 'The report contains no fights.');
  }
  if (selector === 'last') {
    return [...fights].sort((left, right) => left.startTime - right.startTime).at(-1) ?? null;
  }
  if (typeof selector === 'number') {
    const fight = fights.find((candidate) => candidate.id === selector);
    if (fight === undefined) {
      throw new WclError('FIGHT_NOT_FOUND', `Fight ${selector} was not found in the report.`, {
        details: { fightID: selector, availableFightIDs: fights.map((candidate) => candidate.id) },
      });
    }
    return fight;
  }
  if (fights.length === 1) return fights[0] ?? null;
  if (!requireSelection) return null;
  throw new WclError(
    'FIGHT_REQUIRED',
    'Choose a fight ID or use a report URL containing fight=<id|last>.',
    {
      details: {
        fights: fights.map((fight) => ({
          id: fight.id,
          name: fight.name,
          startTime: fight.startTime,
        })),
      },
    },
  );
}

function warning(component: string, error: unknown): JsonObject {
  return { component, error: errorToJson(error) };
}

function eventTimestamp(event: JsonValue): number | null {
  if (!isJsonObject(event)) return null;
  const timestamp = event['timestamp'];
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : null;
}

export class WclService {
  constructor(
    readonly client: WclClient,
    readonly state = new WclStateStore(defaultStateDirectory()),
  ) {}

  static fromConfig(config: WclConfig): WclService {
    return new WclService(new WclClient(config), new WclStateStore(config.stateDirectory));
  }

  async getReport(
    reportInput: string,
    options: CommonOptions & {
      allowUnlisted?: boolean | undefined;
      accessMode?: WclAccessMode | undefined;
    } = {},
  ) {
    const reference = resolveReportReference(reportInput, options.region);
    const value = await this.client.query(
      reference.origin,
      GET_REPORT_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: options.allowUnlisted ?? true,
      },
      { mode: options.accessMode },
    );
    const response = parseResponse(getReportResponseSchema, value, 'report');
    return {
      reportReference: reference,
      report: requireReport(response.reportData.report, reference.reportCode),
    };
  }

  async listFights(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    const reference = resolveReportReference(reportInput, options.region);
    const fights = await this.fetchFights(reference, options.translate ?? true, options.accessMode);
    const selected = selectFight(fights, options.fight ?? reference.fight, false);
    return {
      reportReference: reference,
      selectedFightID: selected?.id ?? null,
      fights,
    };
  }

  async listPlayers(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    const reference = resolveReportReference(reportInput, options.region);
    const players = await this.fetchPlayers(
      reference,
      options.translate ?? true,
      options.accessMode,
    );
    const selector = options.fight ?? reference.fight;
    if (selector === null) {
      return { reportReference: reference, selectedFightID: null, players };
    }
    const fights = await this.fetchFights(reference, options.translate ?? true, options.accessMode);
    const fight = selectFight(fights, selector, true);
    return {
      reportReference: reference,
      selectedFightID: fight?.id ?? null,
      players: players.filter((player) => fight !== null && player.fightIDs.includes(fight.id)),
    };
  }

  async listDungeonPulls(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    const { reference, fight } = await this.resolveFight(reportInput, options);
    const value = await this.client.query(
      reference.origin,
      GET_DUNGEON_PULLS_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        fightIDs: [fight.id],
        translate: options.translate ?? true,
      },
      { mode: options.accessMode },
    );
    const response = parseResponse(dungeonPullsResponseSchema, value, 'dungeon pulls');
    const report = requireReport(response.reportData.report, reference.reportCode);
    const selected = report.fights?.find((candidate) => candidate.id === fight.id);
    if (selected === undefined) {
      throw new WclError('FIGHT_NOT_FOUND', `Fight ${fight.id} was not returned by Warcraft Logs.`);
    }
    return {
      reportReference: reference,
      fight,
      pulls: selected.dungeonPulls ?? [],
    };
  }

  async getTalentImportCode(
    reportInput: string,
    actorID: number,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    assertIntegerRange(actorID, 'actorID', 1, 2_147_483_647);
    const { reference, fight } = await this.resolveFight(reportInput, options);
    return this.fetchTalentImportCode(reference, fight, actorID, options.accessMode);
  }

  async getTable(
    reportInput: string,
    dataType: TableDataType,
    options: TableOptions = {},
  ): Promise<NormalizedTable> {
    const { reference, fight } = await this.resolveFight(reportInput, options);
    return this.fetchTable(reference, fight, dataType, options.filter ?? {}, options);
  }

  async getEvents(
    reportInput: string,
    query: EventQuery,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    const { reference, fight } = await this.resolveFight(reportInput, options);
    const maxEvents = query.maxEvents ?? DEFAULT_EVENT_LIMIT;
    const pageSize = query.pageSize ?? DEFAULT_EVENT_PAGE_SIZE;
    const maxPages = query.maxPages ?? DEFAULT_EVENT_MAX_PAGES;
    const maxPayloadBytes = query.maxPayloadBytes ?? DEFAULT_EVENT_MAX_BYTES;
    assertIntegerRange(maxEvents, 'maxEvents', MIN_EVENT_LIMIT, MAX_EVENT_LIMIT);
    assertIntegerRange(pageSize, 'pageSize', MIN_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE);
    assertIntegerRange(maxPages, 'maxPages', 1, MAX_EVENT_MAX_PAGES);
    assertIntegerRange(maxPayloadBytes, 'maxPayloadBytes', 10_000, MAX_EVENT_MAX_BYTES);

    const requestedStart = query.startTime ?? fight.startTime;
    const endTime = query.endTime ?? fight.endTime;
    let cursor = query.cursor ?? requestedStart;
    if (
      requestedStart < fight.startTime ||
      endTime > fight.endTime ||
      requestedStart >= endTime ||
      cursor < requestedStart ||
      cursor >= endTime
    ) {
      throw new WclError(
        'INVALID_ARGUMENT',
        'The event time window and cursor must stay within the selected fight.',
        {
          details: {
            fightStartTime: fight.startTime,
            fightEndTime: fight.endTime,
            requestedStart,
            endTime,
            cursor,
          },
        },
      );
    }

    const events: JsonValue[] = [];
    const warnings: JsonObject[] = [];
    let pagesFetched = 0;
    let nextPageTimestamp: number | null = cursor;
    let stopReason: 'complete' | 'maxEvents' | 'maxPages' | 'payloadBudget' | 'invalidCursor' =
      'complete';
    let cursorMayRepeat = false;
    const eventBudget = Math.max(1_000, maxPayloadBytes - 4_096);
    let eventsBytes = 2;

    while (pagesFetched < maxPages && events.length < maxEvents) {
      const remaining = maxEvents - events.length;
      const limit = Math.max(MIN_EVENT_PAGE_SIZE, Math.min(pageSize, remaining));
      const page = await this.fetchEventPage(
        reference,
        fight,
        query,
        cursor,
        endTime,
        limit,
        options.accessMode,
      );
      pagesFetched += 1;

      let consumedWholePage = true;
      for (const event of page.data) {
        const encodedBytes = byteLength(event) + (events.length === 0 ? 0 : 1);
        if (encodedBytes > eventBudget && events.length === 0) {
          throw new WclError(
            'PAYLOAD_TOO_LARGE',
            'A single Warcraft Logs event exceeds the payload budget.',
            {
              details: { eventBytes: encodedBytes, maxPayloadBytes },
            },
          );
        }
        if (eventsBytes + encodedBytes > eventBudget || events.length >= maxEvents) {
          consumedWholePage = false;
          stopReason = events.length >= maxEvents ? 'maxEvents' : 'payloadBudget';
          nextPageTimestamp = eventTimestamp(event) ?? cursor;
          cursorMayRepeat = true;
          break;
        }
        events.push(event);
        eventsBytes += encodedBytes;
      }
      if (!consumedWholePage) break;
      if (page.nextPageTimestamp === null) {
        nextPageTimestamp = null;
        stopReason = 'complete';
        break;
      }
      if (page.nextPageTimestamp <= cursor) {
        nextPageTimestamp = page.nextPageTimestamp;
        stopReason = 'invalidCursor';
        warnings.push({
          component: 'events',
          message: 'Warcraft Logs returned a non-advancing pagination cursor.',
        });
        break;
      }
      cursor = page.nextPageTimestamp;
      nextPageTimestamp = cursor;
      if (events.length >= maxEvents) stopReason = 'maxEvents';
    }

    if (nextPageTimestamp !== null && stopReason === 'complete') {
      stopReason = pagesFetched >= maxPages ? 'maxPages' : 'maxEvents';
    }

    const result = {
      reportReference: reference,
      fight,
      query: {
        dataType: query.dataType,
        sourceID: query.sourceID ?? null,
        targetID: query.targetID ?? null,
        abilityID: query.abilityID ?? null,
        startTime: requestedStart,
        endTime,
        initialCursor: query.cursor ?? null,
      },
      events,
      pagination: {
        count: events.length,
        pagesFetched,
        nextPageTimestamp,
        hasMore: nextPageTimestamp !== null,
        stopReason,
        cursorMayRepeat,
      },
      budget: { maxEvents, pageSize, maxPages, maxPayloadBytes },
      warnings,
    };
    const resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    if (resultBytes > maxPayloadBytes) {
      throw new WclError(
        'PAYLOAD_TOO_LARGE',
        'The bounded event response exceeded its final payload budget.',
        {
          details: { resultBytes, maxPayloadBytes },
        },
      );
    }
    return result;
  }

  async getMythicPlusSummary(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    const { reference, fight } = await this.resolveFight(reportInput, options);
    const players = (
      await this.fetchPlayers(reference, options.translate ?? true, options.accessMode)
    ).filter((player) => fight.friendlyPlayers.includes(player.id ?? -1));
    const tableRequests = [
      ['damage', 'DamageDone', 'Source'],
      ['healing', 'Healing', 'Source'],
      ['deaths', 'Deaths', 'Target'],
      ['interrupts', 'Interrupts', 'Source'],
    ] as const;
    const settled = await Promise.allSettled(
      tableRequests.map(([, dataType, viewBy]) =>
        this.fetchTable(
          reference,
          fight,
          dataType,
          { viewBy },
          {
            maxEntries: 100,
            maxPayloadBytes: 200_000,
            translate: options.translate,
            accessMode: options.accessMode,
          },
        ),
      ),
    );
    const tables = new Map<string, NormalizedTable>();
    const warnings: JsonObject[] = [];
    settled.forEach((result, index) => {
      const component = tableRequests[index]?.[0] ?? `table-${index}`;
      if (result.status === 'fulfilled') tables.set(component, result.value);
      else warnings.push(warning(component, result.reason));
    });

    const durationMs = fight.keystoneTime ?? fight.endTime - fight.startTime;
    const durationSeconds = durationMs > 0 ? durationMs / 1_000 : null;
    const playerRows = players
      .map((player) => {
        const damageTable = tables.get('damage');
        const healingTable = tables.get('healing');
        const deathsTable = tables.get('deaths');
        const interruptsTable = tables.get('interrupts');
        const damage = this.findPlayerEntry(damageTable, player);
        const healing = this.findPlayerEntry(healingTable, player);
        const deaths = this.findPlayerEntry(deathsTable, player);
        const interrupts = this.findPlayerEntry(interruptsTable, player);
        const totalDamage =
          damageTable === undefined
            ? null
            : damage === null
              ? 0
              : countForEntry(damage, 'DamageDone');
        const totalHealing =
          healingTable === undefined
            ? null
            : healing === null
              ? 0
              : countForEntry(healing, 'Healing');
        return {
          id: player.id,
          name: player.name,
          server: player.server,
          class: player.subType,
          specs: player.specs,
          itemLevels: player.itemLevels,
          totalDamage,
          dps:
            totalDamage === null || durationSeconds === null
              ? null
              : Math.round(totalDamage / durationSeconds),
          totalHealing,
          hps:
            totalHealing === null || durationSeconds === null
              ? null
              : Math.round(totalHealing / durationSeconds),
          deaths:
            deathsTable === undefined
              ? null
              : deaths === null
                ? 0
                : countForEntry(deaths, 'Deaths'),
          interrupts:
            interruptsTable === undefined
              ? null
              : interrupts === null
                ? 0
                : countForEntry(interrupts, 'Interrupts'),
        };
      })
      .sort((left, right) => (right.totalDamage ?? -1) - (left.totalDamage ?? -1));

    const contentType =
      fight.keystoneLevel !== null ? 'mythicplus' : fight.encounterID > 0 ? 'raid' : 'other';
    const location = fight.gameZone?.name ?? fight.name;

    return {
      reportReference: reference,
      fight,
      contentType,
      location,
      dungeon: contentType === 'mythicplus' ? location : null,
      keyLevel: fight.keystoneLevel,
      durationMs,
      durationSeconds,
      completed: fight.kill,
      keystoneBonus: fight.keystoneBonus,
      rating: fight.rating,
      enemyForces: {
        reached: fight.countReached,
        required: fight.countRequired,
        percent:
          fight.countReached === null || fight.countRequired === null || fight.countRequired === 0
            ? null
            : Math.round((fight.countReached / fight.countRequired) * 10_000) / 100,
      },
      players: playerRows,
      warnings,
    };
  }

  async getPlayerAnalysisContext(
    reportInput: string,
    playerInput: number | string,
    options: CommonOptions & {
      fight?: FightSelector | undefined;
      maxEntries?: number | undefined;
      maxPayloadBytes?: number | undefined;
    } = {},
  ) {
    const { reference, fight } = await this.resolveFight(reportInput, options);
    const players = await this.fetchPlayers(
      reference,
      options.translate ?? true,
      options.accessMode,
    );
    const player = this.resolvePlayer(players, playerInput, fight);
    const actorID = player.id;
    if (actorID === null) {
      throw new WclError('PLAYER_NOT_FOUND', 'The selected player has no report actor ID.');
    }
    const maxEntries = options.maxEntries ?? 100;
    const maxPayloadBytes = options.maxPayloadBytes ?? 600_000;
    assertIntegerRange(maxEntries, 'maxEntries', 1, 200);
    assertIntegerRange(maxPayloadBytes, 'maxPayloadBytes', 100_000, MAX_EVENT_MAX_BYTES);
    const evidenceOptions = {
      maxEntries,
      maxPayloadBytes: 80_000,
      translate: options.translate,
      accessMode: options.accessMode,
    };

    const components: [string, () => Promise<unknown>][] = [
      [
        'damageDone',
        () =>
          this.fetchTable(reference, fight, 'DamageDone', { sourceID: actorID }, evidenceOptions),
      ],
      [
        'casts',
        () => this.fetchTable(reference, fight, 'Casts', { sourceID: actorID }, evidenceOptions),
      ],
      [
        'damageTaken',
        () =>
          this.fetchTable(reference, fight, 'DamageTaken', { targetID: actorID }, evidenceOptions),
      ],
      [
        'interrupts',
        () =>
          this.fetchTable(reference, fight, 'Interrupts', { sourceID: actorID }, evidenceOptions),
      ],
      [
        'deaths',
        () => this.fetchTable(reference, fight, 'Deaths', { targetID: actorID }, evidenceOptions),
      ],
      [
        'buffs',
        () => this.fetchTable(reference, fight, 'Buffs', { targetID: actorID }, evidenceOptions),
      ],
      [
        'resources',
        () =>
          this.fetchTable(reference, fight, 'Resources', { sourceID: actorID }, evidenceOptions),
      ],
      [
        'combatantInfo',
        () =>
          this.getEventsForResolvedFight(
            reference,
            fight,
            {
              dataType: 'CombatantInfo',
              sourceID: actorID,
              maxEvents: 100,
              pageSize: 100,
              maxPages: 1,
              maxPayloadBytes: 100_000,
              translate: options.translate,
            },
            options.accessMode,
          ),
      ],
      [
        'talentImportCode',
        () => this.fetchTalentImportCode(reference, fight, actorID, options.accessMode),
      ],
    ];
    const settled = await Promise.allSettled(components.map(([, request]) => request()));
    const evidence: Record<string, JsonValue> = {};
    const warnings: JsonObject[] = [];
    const evidenceBudget = maxPayloadBytes - 20_000;
    let evidenceBytes = 2;
    settled.forEach((result, index) => {
      const component = components[index]?.[0] ?? `component-${index}`;
      if (result.status === 'rejected') {
        warnings.push(warning(component, result.reason));
        return;
      }
      const componentValue = jsonDetail(result.value);
      const componentBytes = byteLength({ [component]: componentValue });
      if (evidenceBytes + componentBytes > evidenceBudget) {
        warnings.push({
          component,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Component omitted to preserve the aggregate player-analysis payload budget.',
        });
        return;
      }
      evidence[component] = componentValue;
      evidenceBytes += componentBytes;
    });

    const result = {
      reportReference: reference,
      fight,
      player,
      sourceTargetSemantics: {
        source: ['DamageDone', 'Casts', 'Interrupts', 'Resources', 'CombatantInfo'],
        target: ['DamageTaken', 'Deaths', 'Buffs'],
      },
      evidence,
      warnings,
      budget: { maxEntriesPerTable: maxEntries, maxPayloadBytes },
      note: 'Evidence is normalized and bounded. Combat recommendations are intentionally left to the consuming model.',
    };
    const resultBytes = byteLength(result);
    if (resultBytes > maxPayloadBytes) {
      throw new WclError(
        'PAYLOAD_TOO_LARGE',
        'The bounded player-analysis context exceeded its final payload budget.',
        { details: { resultBytes, maxPayloadBytes } },
      );
    }
    return result;
  }

  async getFightSummary(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined } = {},
  ) {
    return this.getMythicPlusSummary(reportInput, options);
  }

  getActiveCharacter(): CharacterIdentity | null {
    return this.state.getActiveCharacter();
  }

  async clearActiveCharacter() {
    await this.state.setActiveCharacter(null);
    return { activeCharacter: null };
  }

  async setActiveCharacter(name: string, server: string, serverRegion: string) {
    const requested = characterIdentity(name, server, serverRegion);
    const profile = await this.fetchCharacter(requested, 'auto');
    const active: CharacterIdentity = {
      name: profile.name,
      serverSlug: profile.server.slug,
      serverRegion: requested.serverRegion,
      apiRegion: requested.apiRegion,
    };
    await this.state.setActiveCharacter(active);
    return { activeCharacter: active, profile };
  }

  async getCharacterSummary(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    } = {},
    options: { accessMode?: WclAccessMode } = {},
  ) {
    const identity = this.resolveCharacterIdentity(input);
    const profile = await this.fetchCharacter(identity, options.accessMode ?? 'auto');
    const recent = await this.fetchRecentReports(identity, 10, 1, options.accessMode ?? 'auto');
    const reports = recent.reports;
    let mythicPlus = 0;
    let raid = 0;
    let other = 0;
    for (const report of reports) {
      for (const fight of report.fights) {
        if (fight.keystoneLevel !== null) mythicPlus += 1;
        else if (fight.difficulty !== null && fight.difficulty >= 1) raid += 1;
        else other += 1;
      }
    }
    return {
      character: profile,
      hasLogs: reports.length > 0,
      sampledReportCount: reports.length,
      totalRecentReports: recent.pagination.total,
      mostRecentReport: reports[0] ?? null,
      contentTypes: { mythicPlus, raid, other },
    };
  }

  async getRecentReports(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    } = {},
    options: {
      accessMode?: WclAccessMode;
      limit?: number;
      page?: number;
      contentType?: 'all' | 'raid' | 'mythicplus';
    } = {},
  ) {
    const identity = this.resolveCharacterIdentity(input);
    const limit = options.limit ?? 10;
    const page = options.page ?? 1;
    assertIntegerRange(limit, 'limit', 1, 100);
    assertIntegerRange(page, 'page', 1, 10_000);
    const result = await this.fetchRecentReports(
      identity,
      limit,
      page,
      options.accessMode ?? 'auto',
    );
    const contentType = options.contentType ?? 'all';
    const reports = result.reports
      .map((report) => ({
        ...report,
        fights: report.fights.filter((fight) => {
          if (contentType === 'mythicplus') return fight.keystoneLevel !== null;
          if (contentType === 'raid') {
            return fight.keystoneLevel === null && (fight.difficulty ?? 0) >= 1;
          }
          return true;
        }),
      }))
      .filter((report) => contentType === 'all' || report.fights.length > 0);
    return { character: result.profile, pagination: result.pagination, reports };
  }

  async getCharacterDeaths(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    } = {},
    options: CharacterHistoryOptions = {},
  ) {
    return this.getCharacterTableHistory(input, 'Deaths', 'target', options);
  }

  async getCharacterCasts(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    } = {},
    options: CharacterHistoryOptions = {},
  ) {
    return this.getCharacterTableHistory(input, 'Casts', 'source', options);
  }

  async getEncounterRankings(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    },
    options: {
      encounterID?: number | undefined;
      zoneID?: number | undefined;
      difficulty?: number | undefined;
      metric?: string | undefined;
      includePrivateLogs?: boolean | undefined;
      accessMode?: WclAccessMode | undefined;
    },
  ) {
    const identity = this.resolveCharacterIdentity(input);
    if ((options.encounterID === undefined) === (options.zoneID === undefined)) {
      throw new WclError(
        'INVALID_ARGUMENT',
        'Provide exactly one of encounterID or zoneID for character rankings.',
      );
    }
    if (options.encounterID !== undefined) {
      assertIntegerRange(options.encounterID, 'encounterID', 1, 2_147_483_647);
    }
    if (options.zoneID !== undefined) {
      assertIntegerRange(options.zoneID, 'zoneID', 1, 2_147_483_647);
    }
    const includePrivateLogs = options.includePrivateLogs ?? false;
    const accessMode = includePrivateLogs ? 'user' : (options.accessMode ?? 'auto');
    const isEncounter = options.encounterID !== undefined;
    const value = await this.client.query(
      WCL_ORIGINS[identity.apiRegion],
      isEncounter ? GET_ENCOUNTER_RANKINGS_QUERY : GET_ZONE_RANKINGS_QUERY,
      {
        name: identity.name,
        serverSlug: identity.serverSlug,
        serverRegion: identity.serverRegion,
        ...(isEncounter ? { encounterID: options.encounterID } : { zoneID: options.zoneID }),
        difficulty: options.difficulty,
        metric: options.metric,
        includePrivateLogs,
      },
      { mode: accessMode },
    );
    const response = parseResponse(rankingResponseSchema, value, 'character rankings');
    const character = requireCharacter(response.characterData.character, identity);
    return {
      character: identity,
      type: isEncounter ? 'encounter' : 'zone',
      ...(isEncounter ? { encounterID: options.encounterID } : { zoneID: options.zoneID }),
      rankings: isEncounter
        ? (character.encounterRankings ?? null)
        : (character.zoneRankings ?? null),
    };
  }

  async subscribeCharacter(
    name: string,
    server: string,
    serverRegion: string,
    options: { accessMode?: WclAccessMode; includeExisting?: boolean } = {},
  ) {
    const requested = characterIdentity(name, server, serverRegion);
    const requestedAccessMode = options.accessMode ?? 'auto';
    const accessMode =
      requestedAccessMode === 'auto'
        ? this.client.hasValidUserToken(WCL_ORIGINS[requested.apiRegion])
          ? 'user'
          : 'public'
        : requestedAccessMode;
    const profile = await this.fetchCharacter(requested, accessMode);
    const identity: CharacterIdentity = {
      name: profile.name,
      serverSlug: profile.server.slug,
      serverRegion: requested.serverRegion,
      apiRegion: requested.apiRegion,
    };
    const recent = await this.fetchRecentReports(identity, 100, 1, accessMode);
    const newestStart = Math.max(0, ...recent.reports.map((report) => report.startTime));
    const boundaryCodes = recent.reports
      .filter((report) => report.startTime === newestStart)
      .map((report) => report.code);
    const subscription = await this.state.addSubscription(
      identity,
      accessMode,
      options.includeExisting === true
        ? { startTime: 0, codes: [] }
        : { startTime: newestStart, codes: boundaryCodes },
    );
    return {
      subscription,
      existingReportsWillBeReturned: options.includeExisting === true,
      delivery: 'poll',
      nextStep: 'Call check_character_subscriptions periodically while the MCP server is running.',
    };
  }

  listCharacterSubscriptions() {
    return { subscriptions: this.state.listSubscriptions(), delivery: 'poll' };
  }

  async unsubscribeCharacter(subscriptionID: string) {
    const removed = await this.state.removeSubscription(subscriptionID);
    if (!removed) {
      throw new WclError('NOT_FOUND', `Subscription ${subscriptionID} was not found.`);
    }
    return { removed: true, subscriptionID };
  }

  async checkCharacterSubscriptions(subscriptionID?: string) {
    const subscriptions = this.state
      .listSubscriptions()
      .filter((subscription) => subscriptionID === undefined || subscription.id === subscriptionID);
    if (subscriptionID !== undefined && subscriptions.length === 0) {
      throw new WclError('NOT_FOUND', `Subscription ${subscriptionID} was not found.`);
    }
    const checkedAt = new Date().toISOString();
    const results = [];
    for (const subscription of subscriptions) {
      try {
        const recent = await this.fetchRecentReports(
          subscription.character,
          100,
          1,
          subscription.accessMode,
        );
        const newReports = recent.reports
          .filter(
            (report) =>
              report.startTime > subscription.lastSeenReportStartTime ||
              (report.startTime === subscription.lastSeenReportStartTime &&
                !subscription.seenReportCodesAtBoundary.includes(report.code)),
          )
          .sort((left, right) => left.startTime - right.startTime);
        const newestStart = Math.max(
          subscription.lastSeenReportStartTime,
          ...recent.reports.map((report) => report.startTime),
        );
        const boundaryCodes = recent.reports
          .filter((report) => report.startTime === newestStart)
          .map((report) => report.code);
        await this.state.updateSubscription(subscription.id, {
          lastCheckedAt: checkedAt,
          lastSeenReportStartTime: newestStart,
          seenReportCodesAtBoundary:
            newestStart === subscription.lastSeenReportStartTime
              ? [...new Set([...subscription.seenReportCodesAtBoundary, ...boundaryCodes])]
              : boundaryCodes,
        });
        results.push({ subscriptionID: subscription.id, newReports, error: null });
      } catch (error) {
        results.push({
          subscriptionID: subscription.id,
          newReports: [],
          error: errorToJson(error),
        });
      }
    }
    return {
      checkedAt,
      newReportCount: results.reduce((sum, result) => sum + result.newReports.length, 0),
      results,
    };
  }

  async doctor(region: WclRegion = 'global', accessMode: 'public' | 'user' = 'public') {
    const origin = WCL_ORIGINS[region];
    const value = await this.client.query(origin, DOCTOR_QUERY, {}, { mode: accessMode });
    parseResponse(doctorResponseSchema, value, 'doctor');
    return { ok: true, region, origin, accessMode };
  }

  private resolveCharacterIdentity(input: {
    name?: string | undefined;
    server?: string | undefined;
    serverRegion?: string | undefined;
  }): CharacterIdentity {
    const provided = [input.name, input.server, input.serverRegion].filter(
      (value) => value !== undefined,
    ).length;
    if (provided === 0) {
      const active = this.state.getActiveCharacter();
      if (active === null) {
        throw new WclError(
          'INVALID_ARGUMENT',
          'Provide name, server, and serverRegion, or call set_active_character first.',
        );
      }
      return active;
    }
    if (provided !== 3) {
      throw new WclError(
        'INVALID_ARGUMENT',
        'name, server, and serverRegion must be provided together.',
      );
    }
    return characterIdentity(input.name!, input.server!, input.serverRegion!);
  }

  private characterProfile(
    identity: CharacterIdentity,
    character: CharacterCore,
  ): CharacterProfile {
    return {
      ...identity,
      id: character.id,
      canonicalID: character.canonicalID,
      name: character.name,
      classID: character.classID,
      level: character.level,
      hidden: character.hidden,
      faction: character.faction,
      server: character.server,
      guilds: character.guilds ?? [],
    };
  }

  private async fetchCharacter(
    identity: CharacterIdentity,
    accessMode: WclAccessMode,
  ): Promise<CharacterProfile> {
    const value = await this.client.query(
      WCL_ORIGINS[identity.apiRegion],
      GET_CHARACTER_QUERY,
      {
        name: identity.name,
        serverSlug: identity.serverSlug,
        serverRegion: identity.serverRegion,
      },
      { mode: accessMode },
    );
    const response = parseResponse(characterResponseSchema, value, 'character');
    const character = requireCharacter(response.characterData.character, identity);
    return this.characterProfile(identity, character);
  }

  private async fetchRecentReports(
    identity: CharacterIdentity,
    limit: number,
    page: number,
    accessMode: WclAccessMode,
  ) {
    const value = await this.client.query(
      WCL_ORIGINS[identity.apiRegion],
      GET_RECENT_REPORTS_QUERY,
      {
        name: identity.name,
        serverSlug: identity.serverSlug,
        serverRegion: identity.serverRegion,
        limit,
        page,
      },
      { mode: accessMode },
    );
    const response = parseResponse(recentReportsResponseSchema, value, 'recent reports');
    const character = requireCharacter(response.characterData.character, identity);
    return {
      profile: this.characterProfile(identity, character),
      pagination: {
        total: character.recentReports.total,
        perPage: character.recentReports.per_page,
        currentPage: character.recentReports.current_page,
        lastPage: character.recentReports.last_page,
        hasMorePages: character.recentReports.has_more_pages,
      },
      reports: character.recentReports.data ?? [],
    };
  }

  private async getCharacterTableHistory(
    input: {
      name?: string | undefined;
      server?: string | undefined;
      serverRegion?: string | undefined;
    },
    dataType: 'Casts' | 'Deaths',
    semantics: 'source' | 'target',
    options: CharacterHistoryOptions,
  ) {
    const identity = this.resolveCharacterIdentity(input);
    const accessMode = options.accessMode ?? 'auto';
    const limitReports = options.limitReports ?? 5;
    const maxEntries = options.maxEntries ?? 100;
    const maxPayloadBytes = options.maxPayloadBytes ?? 600_000;
    assertIntegerRange(limitReports, 'limitReports', 1, 10);
    assertIntegerRange(maxEntries, 'maxEntries', 1, 200);
    assertIntegerRange(maxPayloadBytes, 'maxPayloadBytes', 100_000, MAX_EVENT_MAX_BYTES);

    const recent = await this.fetchRecentReports(identity, limitReports, 1, accessMode);
    const contentType = options.contentType ?? 'all';
    const targets = recent.reports
      .map((report) => ({
        report,
        fights: report.fights
          .filter((fight) => {
            if (contentType === 'mythicplus') return fight.keystoneLevel !== null;
            if (contentType === 'raid') {
              return fight.keystoneLevel === null && (fight.difficulty ?? 0) >= 1;
            }
            return true;
          })
          .slice(0, 20),
      }))
      .filter((target) => target.fights.length > 0);
    const perTableBudget = Math.max(
      10_000,
      Math.min(120_000, Math.floor((maxPayloadBytes - 30_000) / Math.max(1, targets.length))),
    );

    const settled = await Promise.allSettled(
      targets.map(async ({ report, fights }) => {
        const reference = resolveReportReference(report.code, identity.apiRegion);
        const players = await this.fetchPlayers(reference, options.translate ?? true, accessMode);
        const matchingByName = players.filter(
          (player) => player.name?.toLocaleLowerCase() === recent.profile.name.toLocaleLowerCase(),
        );
        const player =
          matchingByName.find(
            (candidate) =>
              candidate.server !== null &&
              normalizeServerSlug(candidate.server) === identity.serverSlug,
          ) ?? matchingByName[0];
        if (player?.id === null || player?.id === undefined) {
          throw new WclError(
            'PLAYER_NOT_FOUND',
            `The character was not found in report ${report.code}.`,
          );
        }
        const fightIDs = fights.map((fight) => fight.id);
        const value = await this.client.query(
          reference.origin,
          GET_TABLE_QUERY,
          {
            code: reference.reportCode,
            allowUnlisted: true,
            dataType,
            fightIDs,
            sourceID: semantics === 'source' ? player.id : undefined,
            targetID: semantics === 'target' ? player.id : undefined,
            abilityID: undefined,
            startTime: undefined,
            endTime: undefined,
            viewBy: 'Ability',
            translate: options.translate ?? true,
          },
          { mode: accessMode },
        );
        const response = parseResponse(tableResponseSchema, value, `${dataType} history table`);
        const resolvedReport = requireReport(response.reportData.report, reference.reportCode);
        if (resolvedReport.table === null) {
          throw new WclError('NOT_FOUND', `Warcraft Logs returned no ${dataType} history table.`);
        }
        return {
          report: {
            code: report.code,
            title: report.title,
            startTime: report.startTime,
            visibility: report.visibility,
          },
          fightIDs,
          actorID: player.id,
          table: normalizeTable(
            dataType,
            fightIDs[0]!,
            semantics === 'source' ? { sourceID: player.id } : { targetID: player.id },
            resolvedReport.table,
            maxEntries,
            perTableBudget,
          ),
        };
      }),
    );

    const results: JsonValue[] = [];
    const warnings: JsonObject[] = [];
    const resultBudget = maxPayloadBytes - 20_000;
    let resultBytes = 2;
    settled.forEach((result, index) => {
      const code = targets[index]?.report.code ?? `report-${index}`;
      if (result.status === 'rejected') {
        warnings.push(warning(code, result.reason));
        return;
      }
      const value = jsonDetail(result.value);
      const bytes = byteLength(value);
      if (resultBytes + bytes > resultBudget) {
        warnings.push({
          component: code,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Report evidence was omitted to preserve the character-history payload budget.',
        });
        return;
      }
      results.push(value);
      resultBytes += bytes;
    });

    const output = {
      character: recent.profile,
      dataType,
      sourceTargetSemantics: semantics,
      contentType,
      reportsScanned: targets.length,
      reportsReturned: results.length,
      fightsAnalyzed: results.reduce<number>((total, result) => {
        if (!isJsonObject(result) || !Array.isArray(result['fightIDs'])) return total;
        return total + result['fightIDs'].length;
      }, 0),
      results,
      warnings,
      budget: {
        limitReports,
        maxFightsPerReport: 20,
        maxEntriesPerTable: maxEntries,
        maxPayloadBytes,
      },
    };
    const outputBytes = byteLength(output);
    if (outputBytes > maxPayloadBytes) {
      throw new WclError(
        'PAYLOAD_TOO_LARGE',
        'The bounded character-history response exceeded its final payload budget.',
        { details: { outputBytes, maxPayloadBytes } },
      );
    }
    return output;
  }

  private async resolveFight(
    reportInput: string,
    options: CommonOptions & { fight?: FightSelector | undefined },
  ): Promise<{ reference: ReportReference; fight: ReportFight }> {
    const reference = resolveReportReference(reportInput, options.region);
    const fights = await this.fetchFights(reference, options.translate ?? true, options.accessMode);
    const fight = selectFight(fights, options.fight ?? reference.fight, true);
    if (fight === null) throw new WclError('FIGHT_NOT_FOUND', 'No fight could be selected.');
    return { reference, fight };
  }

  private async fetchFights(
    reference: ReportReference,
    translate: boolean,
    accessMode?: WclAccessMode,
  ): Promise<ReportFight[]> {
    const value = await this.client.query(
      reference.origin,
      LIST_FIGHTS_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        translate,
      },
      { mode: accessMode },
    );
    const response = parseResponse(listFightsResponseSchema, value, 'fights');
    const report = requireReport(response.reportData.report, reference.reportCode);
    return report.fights ?? [];
  }

  private async fetchPlayers(
    reference: ReportReference,
    translate: boolean,
    accessMode?: WclAccessMode,
  ): Promise<PlayerSummary[]> {
    const value = await this.client.query(
      reference.origin,
      LIST_PLAYERS_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        translate,
      },
      { mode: accessMode },
    );
    const response = parseResponse(listPlayersResponseSchema, value, 'players');
    const report = requireReport(response.reportData.report, reference.reportCode);
    const actors = report.masterData?.actors ?? [];
    const fights = report.fights ?? [];
    return actors.map((actor) => {
      const fightIDs: number[] = [];
      const specs = new Set<string>();
      const itemLevels = new Set<number>();
      for (const fight of fights) {
        fight.friendlyPlayers.forEach((actorID, index) => {
          if (actorID !== actor.id) return;
          fightIDs.push(fight.id);
          const spec = fight.friendlySpecs[index];
          const itemLevel = fight.friendlyItemLevels[index];
          if (typeof spec === 'string' && spec !== '') specs.add(spec);
          if (typeof itemLevel === 'number' && Number.isFinite(itemLevel)) {
            itemLevels.add(itemLevel);
          }
        });
      }
      return { ...actor, fightIDs, specs: [...specs], itemLevels: [...itemLevels] };
    });
  }

  private async fetchTalentImportCode(
    reference: ReportReference,
    fight: ReportFight,
    actorID: number,
    accessMode?: WclAccessMode,
  ) {
    const value = await this.client.query(
      reference.origin,
      GET_TALENT_IMPORT_CODE_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        fightIDs: [fight.id],
        actorID,
      },
      { mode: accessMode },
    );
    const response = parseResponse(talentResponseSchema, value, 'talent import code');
    const report = requireReport(response.reportData.report, reference.reportCode);
    const selected = report.fights?.find((candidate) => candidate.id === fight.id);
    if (selected === undefined) {
      throw new WclError('FIGHT_NOT_FOUND', `Fight ${fight.id} was not returned by Warcraft Logs.`);
    }
    return {
      reportReference: reference,
      fightID: fight.id,
      actorID,
      talentImportCode: selected.talentImportCode,
    };
  }

  private async fetchTable(
    reference: ReportReference,
    fight: ReportFight,
    dataType: TableDataType,
    filter: TableFilter,
    options: {
      maxEntries?: number | undefined;
      maxPayloadBytes?: number | undefined;
      translate?: boolean | undefined;
      accessMode?: WclAccessMode | undefined;
    },
  ): Promise<NormalizedTable> {
    const maxEntries = options.maxEntries ?? DEFAULT_TABLE_MAX_ENTRIES;
    const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_TABLE_MAX_BYTES;
    assertIntegerRange(maxEntries, 'maxEntries', 1, MAX_TABLE_MAX_ENTRIES);
    assertIntegerRange(maxPayloadBytes, 'maxPayloadBytes', 10_000, MAX_TABLE_MAX_BYTES);
    if (
      filter.startTime !== undefined &&
      (filter.startTime < fight.startTime || filter.startTime >= fight.endTime)
    ) {
      throw new WclError('INVALID_ARGUMENT', 'startTime must be within the selected fight.');
    }
    if (
      filter.endTime !== undefined &&
      (filter.endTime <= fight.startTime || filter.endTime > fight.endTime)
    ) {
      throw new WclError('INVALID_ARGUMENT', 'endTime must be within the selected fight.');
    }
    if (
      filter.startTime !== undefined &&
      filter.endTime !== undefined &&
      filter.startTime >= filter.endTime
    ) {
      throw new WclError('INVALID_ARGUMENT', 'startTime must be earlier than endTime.');
    }

    const value = await this.client.query(
      reference.origin,
      GET_TABLE_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        dataType,
        fightIDs: [fight.id],
        sourceID: filter.sourceID,
        targetID: filter.targetID,
        abilityID: filter.abilityID,
        startTime: filter.startTime,
        endTime: filter.endTime,
        viewBy: filter.viewBy,
        translate: filter.translate ?? options.translate ?? true,
      },
      { mode: options.accessMode },
    );
    const response = parseResponse(tableResponseSchema, value, `${dataType} table`);
    const report = requireReport(response.reportData.report, reference.reportCode);
    if (report.table === null) {
      throw new WclError(
        'NOT_FOUND',
        `Warcraft Logs returned no ${dataType} table for this fight.`,
      );
    }
    return normalizeTable(dataType, fight.id, filter, report.table, maxEntries, maxPayloadBytes);
  }

  private async fetchEventPage(
    reference: ReportReference,
    fight: ReportFight,
    query: EventQuery,
    startTime: number,
    endTime: number,
    limit: number,
    accessMode?: WclAccessMode,
  ): Promise<EventPage> {
    const value = await this.client.query(
      reference.origin,
      GET_EVENTS_QUERY,
      {
        code: reference.reportCode,
        allowUnlisted: true,
        dataType: query.dataType,
        fightIDs: [fight.id],
        sourceID: query.sourceID,
        targetID: query.targetID,
        abilityID: query.abilityID,
        startTime,
        endTime,
        limit,
        includeResources: query.includeResources ?? false,
        translate: query.translate ?? true,
      },
      { mode: accessMode },
    );
    const response = parseResponse(eventsResponseSchema, value, 'events');
    const report = requireReport(response.reportData.report, reference.reportCode);
    if (report.events === null) {
      throw new WclError('NOT_FOUND', 'Warcraft Logs returned no events for this query.');
    }
    return report.events;
  }

  private async getEventsForResolvedFight(
    reference: ReportReference,
    fight: ReportFight,
    query: EventQuery,
    accessMode?: WclAccessMode,
  ) {
    const page = await this.fetchEventPage(
      reference,
      fight,
      query,
      query.startTime ?? fight.startTime,
      query.endTime ?? fight.endTime,
      query.pageSize ?? 100,
      accessMode,
    );
    const maxBytes = query.maxPayloadBytes ?? 120_000;
    if (byteLength(page.data) > maxBytes) {
      throw new WclError('PAYLOAD_TOO_LARGE', 'Combatant info exceeded its payload budget.', {
        details: { maxPayloadBytes: maxBytes },
      });
    }
    return {
      reportReference: reference,
      fightID: fight.id,
      events: page.data.slice(0, query.maxEvents ?? 100),
      nextPageTimestamp: page.nextPageTimestamp,
    };
  }

  private findPlayerEntry(
    table: NormalizedTable | undefined,
    player: PlayerSummary,
  ): JsonObject | null {
    if (table === undefined) return null;
    const entries = getTableEntries(table.data);
    return (
      entries.find((entry) => {
        const id = numberField(entry, ['id', 'actorID', 'sourceID', 'targetID']);
        if (id !== null && player.id !== null && id === player.id) return true;
        const name = stringField(entry, ['name', 'actorName']);
        return (
          name !== null &&
          player.name !== null &&
          name.toLocaleLowerCase() === player.name.toLocaleLowerCase()
        );
      }) ?? null
    );
  }

  private resolvePlayer(
    players: PlayerSummary[],
    input: number | string,
    fight: ReportFight,
  ): PlayerSummary {
    const participants = players.filter((player) =>
      fight.friendlyPlayers.includes(player.id ?? -1),
    );
    const player =
      typeof input === 'number'
        ? participants.find((candidate) => candidate.id === input)
        : participants.find(
            (candidate) => candidate.name?.toLocaleLowerCase() === input.toLocaleLowerCase(),
          );
    if (player === undefined) {
      throw new WclError(
        'PLAYER_NOT_FOUND',
        'The requested player was not found in the selected fight.',
        {
          details: {
            player: jsonDetail(input),
            availablePlayers: participants.map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
            })),
          },
        },
      );
    }
    return player;
  }
}

export { selectFight };
