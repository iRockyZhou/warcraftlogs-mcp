import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  WclStateStore,
  authFilePath,
  loadStoredAuth,
  removeUserToken,
  saveUserToken,
  stateFilePath,
} from '../src/storage.js';
import type { CharacterIdentity } from '../src/types.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'warcraftlogs-mcp-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const CHARACTER: CharacterIdentity = {
  name: 'Alice',
  serverSlug: 'area-52',
  serverRegion: 'us',
  apiRegion: 'global',
};

describe('secure local state', () => {
  it('persists user tokens in a private file and never returns them from removal', async () => {
    const directory = await temporaryDirectory();
    await saveUserToken(directory, 'global', {
      accessToken: 'secret-user-token',
      expiresAt: 2_000_000_000_000,
    });

    expect(loadStoredAuth(directory).tokens.global).toEqual({
      accessToken: 'secret-user-token',
      expiresAt: 2_000_000_000_000,
    });
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(authFilePath(directory))).mode & 0o777).toBe(0o600);
    expect(await removeUserToken(directory, 'global')).toBe(true);
    expect(loadStoredAuth(directory).tokens.global).toBeUndefined();
  });

  it('does not apply a stored expiry timestamp to an environment token override', async () => {
    const directory = await temporaryDirectory();
    await saveUserToken(directory, 'global', {
      accessToken: 'expired-stored-token',
      expiresAt: 1,
    });
    const config = loadConfig({
      WCL_STATE_DIR: directory,
      WCL_USER_ACCESS_TOKEN: 'environment-token',
    });

    expect(config.userAccessTokens.global).toBe('environment-token');
    expect(config.userTokenExpiresAt.global).toBeUndefined();
  });

  it('defaults and validates the interactive OAuth login timeout', async () => {
    const directory = await temporaryDirectory();
    expect(loadConfig({ WCL_STATE_DIR: directory }).oauthLoginTimeoutMs).toBe(15 * 60_000);
    expect(
      loadConfig({ WCL_STATE_DIR: directory, WCL_OAUTH_LOGIN_TIMEOUT_MS: '120000' })
        .oauthLoginTimeoutMs,
    ).toBe(120_000);
    expect(() =>
      loadConfig({ WCL_STATE_DIR: directory, WCL_OAUTH_LOGIN_TIMEOUT_MS: '1000' }),
    ).toThrow();
  });

  it('serializes concurrent state updates and advances a subscription cursor', async () => {
    const directory = await temporaryDirectory();
    const store = new WclStateStore(directory);
    const second = { ...CHARACTER, name: 'Bob' };
    const [firstSubscription, secondSubscription] = await Promise.all([
      store.addSubscription(CHARACTER, 'auto', { startTime: 100, codes: ['old-a'] }),
      store.addSubscription(second, 'public', { startTime: 200, codes: ['old-b'] }),
    ]);
    await store.setActiveCharacter(CHARACTER);
    await store.updateSubscription(firstSubscription.id, {
      lastCheckedAt: '2026-09-09T00:00:00.000Z',
      lastSeenReportStartTime: 300,
      seenReportCodesAtBoundary: ['new-a'],
    });

    expect(store.getActiveCharacter()).toEqual(CHARACTER);
    expect(store.listSubscriptions()).toHaveLength(2);
    expect(store.listSubscriptions()).toContainEqual(
      expect.objectContaining({
        id: firstSubscription.id,
        lastSeenReportStartTime: 300,
        seenReportCodesAtBoundary: ['new-a'],
      }),
    );
    expect(store.listSubscriptions()).toContainEqual(
      expect.objectContaining({ id: secondSubscription.id, character: second }),
    );
    expect((await stat(stateFilePath(directory))).mode & 0o777).toBe(0o600);
  });
});
