import type { DomainInvariantViolation, Game, PlayerID, State } from '../../types';
import { previewValue, stableHash } from './actions';
import {
  sanitizeStateForHash,
  findJsonSerializationProblems,
  stateHash,
  cloneForProbe,
} from './state';
import type { HarnessIssue, HarnessMode } from './types';

export interface InvariantContext {
  game: Game;
  state: State;
  slug: string;
  seed: string;
  numPlayers: number;
  setupVariant: string;
  mode: HarnessMode;
  maxSteps: number;
  step: number;
  reproductionCommand: string;
}

export function checkHarnessInvariants(ctx: InvariantContext): HarnessIssue[] {
  const issues: HarnessIssue[] = [];
  const actors = actorIDs(ctx.state);

  const serializationProblems = findJsonSerializationProblems(sanitizeStateForHash(ctx.state));
  if (serializationProblems.length > 0) {
    issues.push(
      issue(ctx, {
        code: 'STATE_NOT_JSON_SERIALIZABLE',
        severity: 'warn',
        message: 'Sanitized state contains values that JSON storage will not preserve.',
        data: { problems: serializationProblems.slice(0, 8) },
      }),
    );
  }

  if (ctx.game.playerView) {
    for (const playerID of playerViewProbeIDs(ctx.state)) {
      const probeG = cloneForProbe(ctx.state.G);
      const probeCtx = cloneForProbe(ctx.state.ctx);
      const before = stableHash({ G: probeG, ctx: probeCtx });
      try {
        ctx.game.playerView({ G: probeG, ctx: probeCtx, playerID });
      } catch (error) {
        if (looksLikeMutationError(error)) {
          issues.push(
            issue(ctx, {
              code: 'PLAYER_VIEW_MUTATED_STATE',
              severity: 'warn',
              playerID,
              message: `playerView attempted to mutate authoritative state for player ${playerID}: ${
                (error as Error).message
              }`,
            }),
          );
          continue;
        }
        issues.push(
          issue(ctx, {
            code: 'PLAYER_VIEW_THREW',
            severity: 'warn',
            playerID,
            message: `playerView threw for player ${playerID}: ${(error as Error).message}`,
          }),
        );
        continue;
      }
      const after = stableHash({ G: probeG, ctx: probeCtx });
      if (before !== after) {
        issues.push(
          issue(ctx, {
            code: 'PLAYER_VIEW_MUTATED_STATE',
            severity: 'warn',
            playerID,
            message: `playerView mutated authoritative state for player ${playerID}.`,
            data: { beforeHash: before, afterHash: after },
          }),
        );
      }
    }
  }

  if (ctx.game.ai?.sampleHiddenState) {
    for (const playerID of actors) {
      const probeG = cloneForProbe(ctx.state.G);
      const before = stableHash(probeG);
      try {
        ctx.game.ai.sampleHiddenState(probeG, playerID);
      } catch (error) {
        if (looksLikeMutationError(error)) {
          issues.push(
            issue(ctx, {
              code: 'SAMPLE_HIDDEN_STATE_MUTATED_STATE',
              severity: 'warn',
              playerID,
              message: `sampleHiddenState attempted to mutate authoritative state for player ${playerID}: ${
                (error as Error).message
              }`,
            }),
          );
          continue;
        }
        issues.push(
          issue(ctx, {
            code: 'SAMPLE_HIDDEN_STATE_THREW',
            severity: 'warn',
            playerID,
            message: `sampleHiddenState threw for player ${playerID}: ${(error as Error).message}`,
          }),
        );
        continue;
      }
      const after = stableHash(probeG);
      if (before !== after) {
        issues.push(
          issue(ctx, {
            code: 'SAMPLE_HIDDEN_STATE_MUTATED_STATE',
            severity: 'warn',
            playerID,
            message: `sampleHiddenState mutated authoritative state for player ${playerID}.`,
            data: { beforeHash: before, afterHash: after },
          }),
        );
      }
    }
  }

  const domainInvariants = ctx.game.ai?.domainInvariants;
  if (domainInvariants) {
    try {
      const violations = domainInvariants(
        cloneForProbe(ctx.state.G),
        cloneForProbe(ctx.state.ctx),
        {
          slug: ctx.slug,
          seed: ctx.seed,
          numPlayers: ctx.numPlayers,
          setupVariant: ctx.setupVariant,
          mode: ctx.mode,
          maxSteps: ctx.maxSteps,
          step: ctx.step,
        },
      );
      for (const violation of violations) {
        issues.push(domainInvariantIssue(ctx, violation));
      }
    } catch (error) {
      issues.push(
        issue(ctx, {
          code: 'DOMAIN_INVARIANT_VIOLATED',
          severity: 'fail',
          message: `domainInvariants threw: ${(error as Error).message}`,
          data: {
            invariantId: 'domainInvariants/threw',
            errorName: (error as Error).name,
            errorMessage: (error as Error).message,
          },
        }),
      );
    }
  }

  return issues;
}

function actorIDs(state: State): PlayerID[] {
  return [...state.ctx.playOrder].sort();
}

function playerViewProbeIDs(state: State): Array<PlayerID | null> {
  return [...actorIDs(state), null];
}

function looksLikeMutationError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return (
    message.includes('Cannot assign to read only property') ||
    message.includes('Cannot add property') ||
    message.includes('Cannot delete property') ||
    message.includes('object is not extensible') ||
    message.includes('read only')
  );
}

function issue(
  ctx: InvariantContext,
  params: Pick<HarnessIssue, 'code' | 'severity' | 'message'> &
    Partial<Pick<HarnessIssue, 'playerID' | 'data'>>,
): HarnessIssue {
  return {
    code: params.code,
    severity: params.severity,
    slug: ctx.slug,
    seed: ctx.seed,
    numPlayers: ctx.numPlayers,
    setupVariant: ctx.setupVariant,
    mode: ctx.mode,
    maxSteps: ctx.maxSteps,
    step: ctx.step,
    playerID: params.playerID,
    phase: ctx.state.ctx.phase ?? null,
    stateHash: stateHash(ctx.state),
    message: params.message,
    data: params.data,
    reproduction: { command: ctx.reproductionCommand },
  };
}

function domainInvariantIssue(
  ctx: InvariantContext,
  violation: DomainInvariantViolation,
): HarnessIssue {
  return issue(ctx, {
    code: 'DOMAIN_INVARIANT_VIOLATED',
    severity: violation.severity ?? 'fail',
    message: violation.message,
    data: domainInvariantData(violation),
  });
}

function domainInvariantData(violation: DomainInvariantViolation): unknown {
  const data =
    violation.data && typeof violation.data === 'object' && !Array.isArray(violation.data)
      ? { invariantId: violation.id, ...violation.data }
      : violation.data !== undefined
        ? { invariantId: violation.id, value: violation.data }
        : { invariantId: violation.id };

  return previewValue(data);
}
