export const GET_REPORT_QUERY = /* GraphQL */ `
  query GetReport($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        code
        title
        startTime
        endTime
        visibility
        revision
        segments
        exportedSegments
        zone {
          id
          name
        }
        archiveStatus {
          isArchived
          isAccessible
          archiveDate
        }
      }
    }
  }
`;

export const LIST_FIGHTS_QUERY = /* GraphQL */ `
  query ListFights($code: String!, $allowUnlisted: Boolean!, $translate: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        fights(translate: $translate) {
          id
          name
          startTime
          endTime
          encounterID
          originalEncounterID
          kill
          difficulty
          size
          inProgress
          averageItemLevel
          friendlyPlayers
          friendlySpecs
          friendlyItemLevels
          gameZone {
            id
            name
          }
          maps {
            id
          }
          keystoneLevel
          keystoneTime
          keystoneBonus
          keystoneAffixes
          rating
          countReached
          countRequired
        }
      }
    }
  }
`;

export const LIST_PLAYERS_QUERY = /* GraphQL */ `
  query ListPlayers($code: String!, $allowUnlisted: Boolean!, $translate: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        masterData(translate: $translate) {
          actors(type: "Player") {
            id
            gameID
            name
            server
            type
            subType
            icon
            petOwner
          }
        }
        fights(translate: $translate) {
          id
          friendlyPlayers
          friendlySpecs
          friendlyItemLevels
        }
      }
    }
  }
`;

export const GET_DUNGEON_PULLS_QUERY = /* GraphQL */ `
  query GetDungeonPulls(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int!]!
    $translate: Boolean!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        fights(fightIDs: $fightIDs, translate: $translate) {
          id
          dungeonPulls {
            id
            name
            startTime
            endTime
            encounterID
            kill
            x
            y
            maps {
              id
            }
            enemyNPCs {
              id
              gameID
              minimumInstanceID
              maximumInstanceID
              minimumInstanceGroupID
              maximumInstanceGroupID
            }
          }
        }
      }
    }
  }
`;

export const GET_TALENT_IMPORT_CODE_QUERY = /* GraphQL */ `
  query GetTalentImportCode(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int!]!
    $actorID: Int!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        fights(fightIDs: $fightIDs) {
          id
          talentImportCode(actorID: $actorID)
        }
      }
    }
  }
`;

export const GET_TABLE_QUERY = /* GraphQL */ `
  query GetReportTable(
    $code: String!
    $allowUnlisted: Boolean!
    $dataType: TableDataType!
    $fightIDs: [Int!]!
    $sourceID: Int
    $targetID: Int
    $abilityID: Float
    $startTime: Float
    $endTime: Float
    $viewBy: ViewType
    $translate: Boolean!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        table(
          dataType: $dataType
          fightIDs: $fightIDs
          sourceID: $sourceID
          targetID: $targetID
          abilityID: $abilityID
          startTime: $startTime
          endTime: $endTime
          viewBy: $viewBy
          translate: $translate
        )
      }
    }
  }
`;

export const GET_EVENTS_QUERY = /* GraphQL */ `
  query GetReportEvents(
    $code: String!
    $allowUnlisted: Boolean!
    $dataType: EventDataType!
    $fightIDs: [Int!]!
    $sourceID: Int
    $targetID: Int
    $abilityID: Float
    $startTime: Float!
    $endTime: Float!
    $limit: Int!
    $includeResources: Boolean!
    $translate: Boolean!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        events(
          dataType: $dataType
          fightIDs: $fightIDs
          sourceID: $sourceID
          targetID: $targetID
          abilityID: $abilityID
          startTime: $startTime
          endTime: $endTime
          limit: $limit
          includeResources: $includeResources
          translate: $translate
          useAbilityIDs: true
          useActorIDs: true
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

export const DOCTOR_QUERY = /* GraphQL */ `
  query Doctor {
    reportData {
      __typename
    }
  }
`;

export const GET_CHARACTER_QUERY = /* GraphQL */ `
  query GetCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
    characterData {
      character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
        id
        canonicalID
        name
        classID
        level
        hidden
        faction {
          id
          name
        }
        server {
          id
          name
          normalizedName
          slug
          region {
            id
            name
            compactName
            slug
          }
        }
        guilds {
          id
          name
        }
      }
    }
  }
`;

export const GET_RECENT_REPORTS_QUERY = /* GraphQL */ `
  query GetRecentReports(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $limit: Int!
    $page: Int!
  ) {
    characterData {
      character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
        id
        canonicalID
        name
        classID
        level
        hidden
        faction {
          id
          name
        }
        server {
          id
          name
          normalizedName
          slug
          region {
            id
            name
            compactName
            slug
          }
        }
        guilds {
          id
          name
        }
        recentReports(limit: $limit, page: $page) {
          total
          per_page
          current_page
          last_page
          has_more_pages
          data {
            code
            title
            startTime
            endTime
            visibility
            owner {
              name
            }
            zone {
              id
              name
            }
            fights(killType: Encounters) {
              id
              name
              startTime
              endTime
              kill
              difficulty
              fightPercentage
              keystoneLevel
            }
          }
        }
      }
    }
  }
`;

export const GET_ENCOUNTER_RANKINGS_QUERY = /* GraphQL */ `
  query GetEncounterRankings(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $encounterID: Int!
    $difficulty: Int
    $metric: CharacterRankingMetricType
    $includePrivateLogs: Boolean!
  ) {
    characterData {
      character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
        encounterRankings(
          encounterID: $encounterID
          difficulty: $difficulty
          metric: $metric
          includePrivateLogs: $includePrivateLogs
        )
      }
    }
  }
`;

export const GET_ZONE_RANKINGS_QUERY = /* GraphQL */ `
  query GetZoneRankings(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $zoneID: Int!
    $difficulty: Int
    $metric: CharacterPageRankingMetricType
    $includePrivateLogs: Boolean!
  ) {
    characterData {
      character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
        zoneRankings(
          zoneID: $zoneID
          difficulty: $difficulty
          metric: $metric
          includePrivateLogs: $includePrivateLogs
        )
      }
    }
  }
`;
