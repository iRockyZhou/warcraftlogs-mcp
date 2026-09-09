import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { WclError } from './errors.js';
import type { CharacterIdentity, CharacterSubscription, WclAccessMode } from './types.js';
import type { WclRegion } from './constants.js';

const storedTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().int().positive().optional(),
});

const authFileSchema = z.object({
  version: z.literal(1),
  tokens: z
    .object({ global: storedTokenSchema.optional(), cn: storedTokenSchema.optional() })
    .default({}),
});

const characterIdentitySchema = z.object({
  name: z.string().min(1),
  serverSlug: z.string().min(1),
  serverRegion: z.enum(['us', 'eu', 'kr', 'tw', 'cn']),
  apiRegion: z.enum(['global', 'cn']),
});
const subscriptionSchema = z.object({
  id: z.uuid(),
  character: characterIdentitySchema,
  accessMode: z.enum(['auto', 'public', 'user']),
  createdAt: z.iso.datetime(),
  lastCheckedAt: z.iso.datetime().nullable(),
  lastSeenReportStartTime: z.number().nonnegative(),
  seenReportCodesAtBoundary: z.array(z.string()),
});
const stateFileSchema = z.object({
  version: z.literal(1),
  activeCharacter: characterIdentitySchema.nullable().default(null),
  subscriptions: z.array(subscriptionSchema).default([]),
});

type AuthFile = z.infer<typeof authFileSchema>;
type StateFile = z.infer<typeof stateFileSchema>;

export function defaultStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['WCL_STATE_DIR']?.trim();
  if (configured !== undefined && configured !== '') return resolve(configured);
  const xdg = env['XDG_CONFIG_HOME']?.trim();
  const root = xdg === undefined || xdg === '' ? join(homedir(), '.config') : xdg;
  return join(root, 'warcraftlogs-mcp');
}

export function authFilePath(stateDirectory: string): string {
  return join(stateDirectory, 'auth.json');
}

export function stateFilePath(stateDirectory: string): string {
  return join(stateDirectory, 'state.json');
}

function parseFile<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new WclError('STORAGE_ERROR', `Could not read ${path}.`, { cause: error });
  }
}

export function loadStoredAuth(stateDirectory: string): AuthFile {
  return parseFile(authFilePath(stateDirectory), authFileSchema, { version: 1, tokens: {} });
}

export function loadStoredState(stateDirectory: string): StateFile {
  return parseFile(stateFilePath(stateDirectory), stateFileSchema, {
    version: 1,
    activeCharacter: null,
    subscriptions: [],
  });
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (cause) {
    throw new WclError('STORAGE_ERROR', `Could not securely write ${path}.`, { cause });
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function saveUserToken(
  stateDirectory: string,
  region: WclRegion,
  token: { accessToken: string; expiresAt?: number },
): Promise<void> {
  const auth = loadStoredAuth(stateDirectory);
  auth.tokens[region] = token;
  await atomicWrite(authFilePath(stateDirectory), authFileSchema.parse(auth));
}

export async function removeUserToken(stateDirectory: string, region: WclRegion): Promise<boolean> {
  const auth = loadStoredAuth(stateDirectory);
  const existed = auth.tokens[region] !== undefined;
  auth.tokens =
    region === 'global'
      ? { ...(auth.tokens.cn === undefined ? {} : { cn: auth.tokens.cn }) }
      : { ...(auth.tokens.global === undefined ? {} : { global: auth.tokens.global }) };
  await atomicWrite(authFilePath(stateDirectory), authFileSchema.parse(auth));
  return existed;
}

export class WclStateStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(work, work);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  getActiveCharacter(): CharacterIdentity | null {
    return loadStoredState(this.directory).activeCharacter;
  }

  async setActiveCharacter(character: CharacterIdentity | null): Promise<void> {
    await this.serialize(async () => {
      const state = loadStoredState(this.directory);
      state.activeCharacter = character;
      await atomicWrite(stateFilePath(this.directory), stateFileSchema.parse(state));
    });
  }

  listSubscriptions(): CharacterSubscription[] {
    return loadStoredState(this.directory).subscriptions;
  }

  async addSubscription(
    character: CharacterIdentity,
    accessMode: WclAccessMode,
    baseline: { startTime: number; codes: string[] },
  ): Promise<CharacterSubscription> {
    return this.serialize(async () => {
      const state = loadStoredState(this.directory);
      const duplicate = state.subscriptions.find(
        (entry) =>
          entry.character.name.toLocaleLowerCase() === character.name.toLocaleLowerCase() &&
          entry.character.serverSlug === character.serverSlug &&
          entry.character.serverRegion === character.serverRegion,
      );
      if (duplicate !== undefined) return duplicate;
      const subscription: CharacterSubscription = {
        id: randomUUID(),
        character,
        accessMode,
        createdAt: new Date().toISOString(),
        lastCheckedAt: null,
        lastSeenReportStartTime: baseline.startTime,
        seenReportCodesAtBoundary: baseline.codes,
      };
      state.subscriptions.push(subscription);
      await atomicWrite(stateFilePath(this.directory), stateFileSchema.parse(state));
      return subscription;
    });
  }

  async removeSubscription(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const state = loadStoredState(this.directory);
      const next = state.subscriptions.filter((entry) => entry.id !== id);
      if (next.length === state.subscriptions.length) return false;
      state.subscriptions = next;
      await atomicWrite(stateFilePath(this.directory), stateFileSchema.parse(state));
      return true;
    });
  }

  async updateSubscription(
    id: string,
    update: Pick<
      CharacterSubscription,
      'lastCheckedAt' | 'lastSeenReportStartTime' | 'seenReportCodesAtBoundary'
    >,
  ): Promise<CharacterSubscription> {
    return this.serialize(async () => {
      const state = loadStoredState(this.directory);
      const index = state.subscriptions.findIndex((entry) => entry.id === id);
      const current = state.subscriptions[index];
      if (current === undefined)
        throw new WclError('NOT_FOUND', `Subscription ${id} was not found.`);
      const next = { ...current, ...update };
      state.subscriptions[index] = next;
      await atomicWrite(stateFilePath(this.directory), stateFileSchema.parse(state));
      return next;
    });
  }
}
