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
  query ListFights($code: String!, $translate: Boolean!) {
    reportData {
      report(code: $code) {
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
  query ListPlayers($code: String!, $translate: Boolean!) {
    reportData {
      report(code: $code) {
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
  query GetDungeonPulls($code: String!, $fightIDs: [Int!]!, $translate: Boolean!) {
    reportData {
      report(code: $code) {
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
  query GetTalentImportCode($code: String!, $fightIDs: [Int!]!, $actorID: Int!) {
    reportData {
      report(code: $code) {
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
      report(code: $code) {
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
      report(code: $code) {
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
