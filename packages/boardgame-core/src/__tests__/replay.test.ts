import { describe, expect, it } from 'vitest';

import {
  parseReplayPackage,
  REPLAY_INDEX_STATUSES,
  REPLAY_PACKAGE_VERSION,
  serializeReplayPackage,
  validateReplayPackage,
  type ReplayIndexRecord,
  type ReplayPackage,
} from '../replay';

function makePackage(overrides: Partial<ReplayPackage> = {}): ReplayPackage {
  const pkg: ReplayPackage = {
    manifest: {
      version: REPLAY_PACKAGE_VERSION,
      matchId: 'match-1',
      slug: 'reversi',
      status: 'finished',
      createdAt: 1,
      finishedAt: 2,
      numPlayers: 2,
      participants: [
        { playerId: '0', userId: 'user-1', isAi: false },
        { playerId: '1', isAi: true },
      ],
      resultSummary: { winner: '0' },
      logConfig: { enabled: true, level: 'action' },
      seed: 'seed-1',
      engineVersion: '1.0.0',
      gameVersion: '2026-05-15',
      recordingMode: 'snapshot',
      stepCount: 1,
      visibilityModes: ['full-reveal'],
      accessPolicy: 'participant-pro',
    },
    steps: [
      {
        index: 0,
        stateId: 1,
        turn: 1,
        phase: 'play',
        actorPlayerId: '0',
        action: { type: 'MAKE_MOVE', payload: { type: 'place' } },
        deltalog: [{ action: 'place' }],
        gameLogDelta: [
          {
            id: 'log-1',
            sequence: 1,
            turn: 1,
            playerId: '0',
            publicMessageKey: 'reversi.log.place',
          },
        ],
        state: { G: { board: [] }, ctx: { turn: 1 } },
      },
    ],
  };

  return {
    ...pkg,
    ...overrides,
    manifest: { ...pkg.manifest, ...overrides.manifest },
    steps: overrides.steps ?? pkg.steps,
  };
}

describe('replay package validation', () => {
  it('exports replay index statuses aligned with the D1 index schema', () => {
    expect(REPLAY_INDEX_STATUSES).toEqual(['pending', 'available', 'failed']);
  });

  it('exports a replay index record shape aligned with the D1 row schema', () => {
    const row = {
      match_id: 'match-1',
      game: 'reversi',
      status: 'available',
      recording_mode: 'snapshot',
      access_policy: 'participant-pro',
      visibility_policy: 'participants',
      object_key: 'replays/reversi/match-1.snapshot.json',
      object_size_bytes: 123,
      object_sha256: 'a'.repeat(64),
      failure_code: null,
      created_at: 1,
      updated_at: 2,
      captured_at: 2,
      available_at: 3,
      failed_at: null,
      expires_at: null,
    } satisfies ReplayIndexRecord;

    expect(row.visibility_policy).toBe('participants');
  });

  it('accepts a snapshot-backed finished-match replay package', () => {
    const result = validateReplayPackage(makePackage());

    expect(result.ok).toBe(true);
    expect(result.value?.manifest.recordingMode).toBe('snapshot');
    expect(result.value?.manifest.accessPolicy).toBe('participant-pro');
    expect(result.value?.manifest.visibilityModes).toEqual(['full-reveal']);
  });

  it('round-trips a valid package through serialization', () => {
    const pkg = makePackage();

    const parsed = parseReplayPackage(serializeReplayPackage(pkg));

    expect(parsed.manifest.matchId).toBe('match-1');
    expect(parsed.steps[0].gameLogDelta[0].sequence).toBe(1);
  });

  it('round-trips numeric state versions, release identity, and per-step versions', () => {
    const legacy = makePackage();
    const pkg = makePackage({
      manifest: {
        engineVersion: undefined,
        gameVersion: undefined,
        engineStateVersion: 1,
        gameStateVersion: 0,
        release: {
          slug: 'reversi',
          version: 'release-7',
          sourceSHA: 'source-sha',
          serverScriptHash: 'server-hash',
          clientBundleHash: 'client-hash',
        },
      },
      steps: [{ ...legacy.steps[0], gameStateVersion: 0 }],
    });

    expect(parseReplayPackage(serializeReplayPackage(pkg))).toEqual(pkg);
  });

  it('round-trips the complete first-party build-input authority group', () => {
    const digest = 'a'.repeat(64);
    const base = makePackage();
    const pkg = makePackage({
      manifest: {
        engineStateVersion: 1,
        gameStateVersion: 0,
        release: {
          slug: 'reversi',
          version: digest,
          authorityKind: 'first-party-build-inputs-v1',
          appSourceTreeSHA256: digest,
          serverAuthoritySHA256: digest,
          clientBundleSHA256: digest,
          deliveryConfigSHA256: digest,
        },
      },
      steps: [{ ...base.steps[0], gameStateVersion: 0 }],
    });

    expect(parseReplayPackage(serializeReplayPackage(pkg))).toEqual(pkg);
  });

  it('rejects incomplete, malformed, or mixed first-party release provenance', () => {
    const digest = 'a'.repeat(64);
    const incomplete = validateReplayPackage(
      makePackage({
        manifest: {
          release: {
            slug: 'reversi',
            version: digest,
            authorityKind: 'first-party-build-inputs-v1',
            appSourceTreeSHA256: digest,
          } as never,
        },
      }),
    );
    const mixed = validateReplayPackage(
      makePackage({
        manifest: {
          release: {
            slug: 'reversi',
            version: digest,
            authorityKind: 'first-party-build-inputs-v1',
            appSourceTreeSHA256: digest,
            serverAuthoritySHA256: digest,
            clientBundleSHA256: digest,
            deliveryConfigSHA256: digest,
            serverScriptHash: digest,
          } as never,
        },
      }),
    );
    const malformed = validateReplayPackage(
      makePackage({
        manifest: {
          release: {
            slug: 'reversi',
            version: 'not-a-release-id',
            authorityKind: 'first-party-build-inputs-v1',
            appSourceTreeSHA256: digest,
            serverAuthoritySHA256: digest,
            clientBundleSHA256: digest,
            deliveryConfigSHA256: 'not-a-digest',
          },
        },
      }),
    );

    expect(incomplete.ok).toBe(false);
    expect(incomplete.errors).toContain(
      'manifest.release.serverAuthoritySHA256 is required for first-party authority',
    );
    expect(mixed.errors).toContain(
      'manifest.release.serverScriptHash must be absent for first-party authority',
    );
    expect(malformed.errors).toContain(
      'manifest.release.version must be a SHA-256 first-party release ID',
    );
    expect(malformed.errors).toContain(
      'manifest.release.deliveryConfigSHA256 is required for first-party authority',
    );
  });

  it('accepts markerless legacy packages as unknown/v0', () => {
    const pkg = makePackage();
    delete pkg.manifest.engineVersion;
    delete pkg.manifest.gameVersion;

    const result = validateReplayPackage(pkg);

    expect(result.ok).toBe(true);
    expect(result.value?.manifest.engineStateVersion).toBeUndefined();
    expect(result.value?.steps[0].gameStateVersion).toBeUndefined();
  });

  it('rejects release and state-version provenance inconsistencies', () => {
    const base = makePackage();
    const releaseMismatch = validateReplayPackage(
      makePackage({
        manifest: {
          release: { slug: 'goita', version: 'release-1' },
        },
      }),
    );
    const stepMismatch = validateReplayPackage(
      makePackage({
        manifest: { engineStateVersion: 1, gameStateVersion: 1 },
        steps: [{ ...base.steps[0], gameStateVersion: 0 }],
      }),
    );

    expect(releaseMismatch.errors).toContain('manifest.release.slug must match manifest.slug');
    expect(stepMismatch.errors).toContain(
      'steps[0].gameStateVersion must match manifest.gameStateVersion',
    );
  });

  it('accepts null phase steps for games without phase configuration', () => {
    const result = validateReplayPackage(
      makePackage({
        steps: [
          {
            ...makePackage().steps[0],
            phase: null,
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.value?.steps[0].phase).toBeNull();
  });

  it('rejects event-sourced or unfinished packages for the MVP boundary', () => {
    const result = validateReplayPackage(
      makePackage({
        manifest: {
          recordingMode: 'event-sourced' as never,
          status: 'playing' as never,
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest.recordingMode must be snapshot');
    expect(result.errors).toContain('manifest.status must be finished');
  });

  it('rejects packages whose manifest step count does not match stored steps', () => {
    const result = validateReplayPackage(makePackage({ manifest: { stepCount: 2 } }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest.stepCount must match steps length');
  });

  it('rejects public-timeline visibility for full-state packages', () => {
    const result = validateReplayPackage(
      makePackage({ manifest: { visibilityModes: ['public-timeline' as never] } }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'manifest.visibilityModes must contain replay visibility modes',
    );
  });

  it('rejects malformed game-log deltas early', () => {
    const pkg = makePackage();
    const result = validateReplayPackage({
      ...pkg,
      steps: [
        {
          ...pkg.steps[0],
          gameLogDelta: [{ id: 'log-1', sequence: 1, turn: 1 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'steps[0].gameLogDelta[0].publicMessageKey must be a non-empty string',
    );
  });

  it('throws a precise parse error for invalid JSON', () => {
    expect(() => parseReplayPackage('{')).toThrow('Invalid replay package JSON');
  });
});
