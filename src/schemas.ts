import { z } from 'zod';

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();
const nullableBoolean = z.boolean().nullable();
const numberArray = z
  .array(z.number().nullable())
  .nullish()
  .transform((value) => value ?? []);
const stringArray = z
  .array(z.string().nullable())
  .nullish()
  .transform((value) => value ?? []);

export const reportSchema = z.object({
  code: z.string(),
  title: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  visibility: z.string(),
  revision: z.number().int(),
  segments: z.number().int(),
  exportedSegments: z.number().int(),
  zone: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  archiveStatus: z
    .object({
      isArchived: z.boolean(),
      isAccessible: z.boolean(),
      archiveDate: z.number().int().nullable(),
    })
    .nullable(),
});

export const actorSchema = z.object({
  id: z.number().int().nullable(),
  gameID: nullableNumber,
  name: nullableString,
  server: nullableString,
  type: nullableString,
  subType: nullableString,
  icon: nullableString,
  petOwner: z.number().int().nullable(),
});

export const fightSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  encounterID: z.number().int(),
  originalEncounterID: z.number().int().nullable(),
  kill: nullableBoolean,
  difficulty: z.number().int().nullable(),
  size: z.number().int().nullable(),
  inProgress: nullableBoolean,
  averageItemLevel: nullableNumber,
  friendlyPlayers: numberArray,
  friendlySpecs: stringArray,
  friendlyItemLevels: numberArray,
  gameZone: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  maps: z
    .array(z.object({ id: z.number().int() }))
    .nullish()
    .transform((value) => value ?? []),
  keystoneLevel: z.number().int().nullable(),
  keystoneTime: nullableNumber,
  keystoneBonus: z.number().int().nullable(),
  keystoneAffixes: numberArray,
  rating: nullableNumber,
  countReached: z.number().int().nullable(),
  countRequired: z.number().int().nullable(),
});

const reportData = <T extends z.ZodType>(report: T) =>
  z.object({ reportData: z.object({ report: report.nullable() }) });

export const getReportResponseSchema = reportData(reportSchema);
export const listFightsResponseSchema = reportData(
  z.object({ fights: z.array(fightSchema).nullable() }),
);

export const listPlayersResponseSchema = reportData(
  z.object({
    masterData: z.object({ actors: z.array(actorSchema).nullable() }).nullable(),
    fights: z
      .array(
        z.object({
          id: z.number().int(),
          friendlyPlayers: numberArray,
          friendlySpecs: stringArray,
          friendlyItemLevels: numberArray,
        }),
      )
      .nullable(),
  }),
);

const dungeonPullSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  encounterID: z.number().int(),
  kill: nullableBoolean,
  x: z.number().int(),
  y: z.number().int(),
  maps: z
    .array(z.object({ id: z.number().int() }))
    .nullish()
    .transform((value) => value ?? []),
  enemyNPCs: z
    .array(
      z.object({
        id: z.number().int().nullable(),
        gameID: z.number().int().nullable(),
        minimumInstanceID: z.number().int().nullable(),
        maximumInstanceID: z.number().int().nullable(),
        minimumInstanceGroupID: z.number().int().nullable(),
        maximumInstanceGroupID: z.number().int().nullable(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

export const dungeonPullsResponseSchema = reportData(
  z.object({
    fights: z
      .array(
        z.object({ id: z.number().int(), dungeonPulls: z.array(dungeonPullSchema).nullable() }),
      )
      .nullable(),
  }),
);

export const talentResponseSchema = reportData(
  z.object({
    fights: z
      .array(z.object({ id: z.number().int(), talentImportCode: z.string().nullable() }))
      .nullable(),
  }),
);

export const tableResponseSchema = reportData(z.object({ table: z.json().nullable() }));

export const eventsResponseSchema = reportData(
  z.object({
    events: z
      .object({
        data: z.array(z.json()),
        nextPageTimestamp: z.number().nullable(),
      })
      .nullable(),
  }),
);

export const doctorResponseSchema = z.object({
  reportData: z.object({ __typename: z.string() }),
});

const characterCoreSchema = z.object({
  id: z.number().int(),
  canonicalID: z.number().int(),
  name: z.string(),
  classID: z.number().int(),
  level: z.number().int(),
  hidden: z.boolean(),
  faction: z.object({ id: z.number().int(), name: z.string() }),
  server: z.object({
    id: z.number().int(),
    name: z.string(),
    normalizedName: z.string(),
    slug: z.string(),
    region: z.object({
      id: z.number().int(),
      name: z.string(),
      compactName: z.string(),
      slug: z.string(),
    }),
  }),
  guilds: z.array(z.object({ id: z.number().int(), name: z.string() })).nullish(),
});

const recentReportSchema = z.object({
  code: z.string(),
  title: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  visibility: z.string(),
  owner: z.object({ name: z.string() }).nullable(),
  zone: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  fights: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        startTime: z.number(),
        endTime: z.number(),
        kill: nullableBoolean,
        difficulty: z.number().int().nullable(),
        fightPercentage: nullableNumber,
        keystoneLevel: z.number().int().nullable(),
      }),
    )
    .nullish()
    .transform((value) => value ?? []),
});

export const characterResponseSchema = z.object({
  characterData: z.object({ character: characterCoreSchema.nullable() }),
});

export const recentReportsResponseSchema = z.object({
  characterData: z.object({
    character: characterCoreSchema
      .extend({
        recentReports: z.object({
          total: z.number().int(),
          per_page: z.number().int(),
          current_page: z.number().int(),
          last_page: z.number().int(),
          has_more_pages: z.boolean(),
          data: z.array(recentReportSchema).nullable(),
        }),
      })
      .nullable(),
  }),
});

export const rankingResponseSchema = z.object({
  characterData: z.object({
    character: z
      .object({
        encounterRankings: z.json().optional(),
        zoneRankings: z.json().optional(),
      })
      .nullable(),
  }),
});
