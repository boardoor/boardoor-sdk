import { makeMove } from '../../core/action-creators';
import { GAME_EVENT } from '../../core/action-types';
import { alea } from '../../plugins/random/random.alea';
import type { ActionError, Game, PlayerID, State } from '../../types';
import {
  normalizeEnumeratedActions,
  normalizePolicyAction,
  previewValue,
  stableHash,
} from './actions';
import { checkHarnessInvariants } from './invariants';
import {
  createHarnessState,
  setupDataHash,
  stateHash,
  stripHarnessTransients,
  cloneForProbe,
} from './state';
import type {
  HarnessCaseInput,
  HarnessCaseResult,
  BestMovePolicyOptions,
  HarnessIssue,
  HarnessIssueCode,
  HarnessMatchTrace,
  HarnessMode,
  HarnessPolicy,
  HarnessPolicyStrength,
  HarnessPolicyResult,
  HarnessStepTrace,
  WeightedHarnessAction,
} from './types';

export async function runHarnessSuite(cases: HarnessCaseInput[]): Promise<HarnessCaseResult[]> {
  const results: HarnessCaseResult[] = [];
  for (const harnessCase of cases) {
    // oxlint-disable-next-line no-await-in-loop -- each case owns a deterministic trace
    results.push(await runHarnessCase(harnessCase));
  }
  return results;
}

export async function runHarnessCase(input: HarnessCaseInput): Promise<HarnessCaseResult> {
  const primary = await runSingleHarnessCase(input);
  const retries = Math.max(1, input.determinismRetries ?? 1);

  for (let i = 1; i < retries; i++) {
    // oxlint-disable-next-line no-await-in-loop -- retries compare against the primary trace
    const retry = await runSingleHarnessCase(input);
    const traceIssue = compareTraces(input, primary, retry);
    if (traceIssue) {
      primary.trace.issues.push(traceIssue);
      break;
    }
    if (primary.trace.terminal.stateHash !== retry.trace.terminal.stateHash) {
      primary.trace.issues.push(
        createIssue(input, {
          code: 'STATE_HASH_DIVERGED',
          severity: 'warn',
          step: primary.trace.steps.length,
          phase: primary.finalState?.ctx.phase ?? null,
          stateHash: primary.finalState ? stateHash(primary.finalState) : undefined,
          message:
            'Deterministic action traces matched, but sanitized terminal state hash differed.',
          data: {
            expectedStateHash: primary.trace.terminal.stateHash,
            actualStateHash: retry.trace.terminal.stateHash,
          },
        }),
      );
      break;
    }
  }

  primary.trace.issues = dedupeIssues(primary.trace.issues);
  return primary;
}

export const enumerateRandomPolicy: HarnessPolicy = ({ game, state, playerID, seed, step }) => {
  if (!game.ai?.enumerate) return { source: 'enumerate-random' };
  const enumerated = game.ai.enumerate(cloneForProbe(state.G), cloneForProbe(state.ctx), playerID);
  const { actions } = normalizeEnumeratedActions(enumerated, playerID);
  return {
    action: pickWeightedAction(actions, makeSeedFromContext(seed, step, playerID, state)),
    source: 'enumerate-random',
  };
};

export const uniformRandomPolicy: HarnessPolicy = ({ game, state, playerID, seed, step }) => {
  if (!game.ai?.enumerate) return { source: 'uniform-random' };
  const enumerated = game.ai.enumerate(cloneForProbe(state.G), cloneForProbe(state.ctx), playerID);
  const { actions } = normalizeEnumeratedActions(enumerated, playerID);
  return {
    action: pickUniformAction(actions, makeSeedFromContext(seed, step, playerID, state)),
    source: 'uniform-random',
  };
};

export function bestMovePolicy(options: BestMovePolicyOptions = {}): HarnessPolicy {
  const initialized = new WeakMap<NonNullable<Game['ai']>, Promise<void>>();

  return async ({ game, state, playerID }) => {
    const ai = game.ai;
    const strength = options.strengths?.[playerID] ?? options.defaultStrength ?? 'weak';
    const startedAt = Date.now();

    if (!ai?.bestMove) {
      return {
        source: 'bestMove',
        strength,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (ai.init) {
      let initPromise = initialized.get(ai);
      if (!initPromise) {
        initPromise = ai.init();
        initialized.set(ai, initPromise);
      }
      await initPromise;
    }

    const best = await ai.bestMove(state.G, state.ctx, playerID, toCoreBestMoveStrength(strength));

    return {
      action: best ? makeMove(best.move, best.args, playerID) : undefined,
      source: 'bestMove',
      strength,
      elapsedMs: Date.now() - startedAt,
    };
  };
}

async function runSingleHarnessCase(input: HarnessCaseInput): Promise<HarnessCaseResult> {
  const mode: HarnessMode = input.mode ?? 'fuzz-random';
  const reproductionCommand =
    input.reproductionCommand ?? 'pnpm --filter @boardoor/core test:run -- game-harness';
  const issues: HarnessIssue[] = [];
  let harnessGame: Game | undefined;
  let state: State | undefined;
  let reducer: ReturnType<typeof createHarnessState>['reducer'] | undefined;

  try {
    const context = createHarnessState(input);
    harnessGame = context.game;
    state = context.state;
    reducer = context.reducer;
  } catch (error) {
    issues.push(
      createIssue(input, {
        code: 'SETUP_THREW',
        severity: 'fail',
        step: 0,
        message: `setup threw: ${(error as Error).message}`,
      }),
    );
  }

  const initialStateHash = state ? stateHash(state) : stableHash(null);
  const trace: HarnessStepTrace[] = [];
  let stepLimitReached = false;

  if (state && harnessGame && reducer) {
    issues.push(...checkInvariants(input, harnessGame, state, 0, reproductionCommand));

    while (trace.length < input.maxSteps && state.ctx.gameover === undefined) {
      const actors = currentActors(state);
      let appliedAny = false;
      let reportedAnyIssue = false;

      for (const playerID of actors) {
        if (state.ctx.gameover !== undefined) break;
        if (trace.length >= input.maxSteps) break;
        if (!currentActors(state).includes(playerID)) continue;
        const actionStep = trace.length;
        // oxlint-disable-next-line no-await-in-loop -- each action mutates the next reducer state
        const policyResult = await choosePolicyAction(
          input,
          harnessGame,
          state,
          playerID,
          actionStep,
        );
        if (policyResult.issues.length > 0) {
          issues.push(...policyResult.issues);
          reportedAnyIssue = true;
          continue;
        }
        const action = policyResult.action;
        if (!action) continue;

        const beforeState = state;
        const stepTrace = toStepTrace(actionStep, beforeState, playerID, {
          ...policyResult,
          action,
        });
        let nextState: ReturnType<typeof reducer>;
        try {
          nextState = reducer(state, action);
        } catch (error) {
          issues.push(
            createReducerThrowIssue(input, {
              policySource: policyResult.source,
              state: beforeState,
              step: actionStep,
              playerID,
              actionHash: stepTrace.actionHash,
              error,
            }),
          );
          reportedAnyIssue = true;
          continue;
        }
        const transientError = nextState.transients?.error;
        state = stripHarnessTransients(reducer, nextState);

        if (transientError) {
          issues.push(
            createReducerIssue(input, {
              mode,
              policySource: policyResult.source,
              state: beforeState,
              step: actionStep,
              playerID,
              actionHash: stepTrace.actionHash,
              error: transientError,
            }),
          );
          reportedAnyIssue = true;
          continue;
        }

        stepTrace.gameoverHash =
          state.ctx.gameover === undefined ? undefined : stableHash(state.ctx.gameover);
        trace.push(stepTrace);
        appliedAny = true;
        issues.push(
          ...checkInvariants(input, harnessGame, state, stepTrace.step + 1, reproductionCommand),
        );
      }

      if (!appliedAny && reportedAnyIssue) {
        break;
      }

      if (!appliedAny && state.ctx.gameover === undefined) {
        issues.push(
          createIssue(input, {
            code:
              trace.length === 0 && mode === 'fuzz-random' && !input.policy
                ? 'NO_ENUMERATOR_OR_EMPTY_ENUMERATE_AT_STEP_0'
                : 'NO_LEGAL_ACTION_AND_NOT_GAMEOVER',
            severity: 'fail',
            step: trace.length,
            phase: state.ctx.phase ?? null,
            stateHash: stateHash(state),
            message: 'No actor produced a legal action before gameover.',
          }),
        );
        break;
      }
    }

    if (state.ctx.gameover === undefined && trace.length >= input.maxSteps) {
      stepLimitReached = true;
      issues.push(
        createIssue(input, {
          code: 'STEP_LIMIT_REACHED',
          severity: input.stepLimitSeverity ?? 'warn',
          step: trace.length,
          phase: state.ctx.phase ?? null,
          stateHash: stateHash(state),
          message: `Harness reached maxSteps=${input.maxSteps} before gameover.`,
        }),
      );
    }
  }

  const finalStateHash = state ? stateHash(state) : stableHash(null);
  const matchTrace: HarnessMatchTrace = {
    version: 1,
    slug: input.slug,
    seed: input.seed,
    numPlayers: input.numPlayers,
    setupVariant: input.setupVariant,
    setupDataHash: setupDataHash(input.setupData),
    policies: { '*': { name: input.policy ? 'custom-policy' : 'enumerate-random' } },
    engineVersion: input.engineVersion ?? {},
    initialStateHash,
    steps: trace,
    terminal: {
      gameoverHash: state?.ctx.gameover === undefined ? undefined : stableHash(state?.ctx.gameover),
      completed: state?.ctx.gameover !== undefined,
      stepLimitReached,
      stateHash: finalStateHash,
    },
    issues: dedupeIssues(issues),
  };

  return {
    version: 1,
    slug: input.slug,
    seed: input.seed,
    numPlayers: input.numPlayers,
    setupVariant: input.setupVariant,
    mode,
    trace: matchTrace,
    finalState: state,
  };
}

async function choosePolicyAction(
  input: HarnessCaseInput,
  game: Game,
  state: State,
  playerID: PlayerID,
  step: number,
): Promise<HarnessPolicyResult & { issues: HarnessIssue[] }> {
  const policy = input.policy ?? enumerateRandomPolicy;
  const policySource =
    policy === enumerateRandomPolicy
      ? 'enumerate-random'
      : policy === uniformRandomPolicy
        ? 'uniform-random'
        : 'bestMove';
  try {
    if (policy === enumerateRandomPolicy || policy === uniformRandomPolicy) {
      if (!game.ai?.enumerate) return { source: policySource, issues: [] };
      let enumerated;
      const probeG = cloneForProbe(state.G);
      const probeCtx = cloneForProbe(state.ctx);
      const beforeProbeHash = stableHash({ G: probeG, ctx: probeCtx });
      try {
        enumerated = game.ai.enumerate(probeG, probeCtx, playerID);
      } catch (error) {
        return {
          source: policySource,
          issues: [
            createIssue(input, {
              code: 'ENUMERATE_THREW',
              severity: 'fail',
              step,
              playerID,
              phase: state.ctx.phase ?? null,
              stateHash: stateHash(state),
              message: `ai.enumerate threw: ${(error as Error).message}`,
            }),
          ],
        };
      }
      const afterProbeHash = stableHash({ G: probeG, ctx: probeCtx });
      const { actions, invalidShapes } = normalizeEnumeratedActions(enumerated, playerID);
      input.onEnumerate?.({
        stateHash: stateHash(state),
        playerID,
        actionHashes: actions.map((action) =>
          stableHash({ type: action.type, payload: action.payload, weight: action.weight ?? 1 }),
        ),
        totalActions: actions.length + invalidShapes.length,
        invalidActions: invalidShapes.length,
      });
      const issues: HarnessIssue[] = [];
      if (beforeProbeHash !== afterProbeHash) {
        issues.push(
          createIssue(input, {
            code: 'ENUMERATE_MUTATED_STATE',
            severity: 'fail',
            step,
            playerID,
            phase: state.ctx.phase ?? null,
            stateHash: stateHash(state),
            message: `ai.enumerate mutated cloned state for player ${playerID}.`,
            data: { beforeHash: beforeProbeHash, afterHash: afterProbeHash },
          }),
        );
      }
      issues.push(
        ...invalidShapes.map((shape) =>
          createIssue(input, {
            code: 'ENUMERATE_RETURNED_INVALID_SHAPE',
            severity: 'fail',
            step,
            playerID,
            phase: state.ctx.phase ?? null,
            stateHash: stateHash(state),
            message: 'ai.enumerate returned an unsupported action shape.',
            data: { shape: previewValue(shape) },
          }),
        ),
      );
      return {
        source: policySource,
        action:
          policy === uniformRandomPolicy
            ? pickUniformAction(actions, makeSeedFromContext(input.seed, step, playerID, state))
            : pickWeightedAction(actions, makeSeedFromContext(input.seed, step, playerID, state)),
        issues,
      };
    }

    const result = await policy({
      game,
      slug: input.slug,
      state,
      playerID,
      seed: input.seed,
      step,
    });
    const normalizedAction = result.action
      ? normalizePolicyAction(result.action, playerID)
      : undefined;
    if (result.action && !normalizedAction) {
      return {
        ...result,
        action: undefined,
        issues: [
          createIssue(input, {
            code: 'POLICY_RETURNED_ILLEGAL_ACTION',
            severity: 'fail',
            step,
            playerID,
            phase: state.ctx.phase ?? null,
            stateHash: stateHash(state),
            message: 'Policy returned an unsupported action shape.',
            data: { action: previewValue(result.action) },
          }),
        ],
      };
    }
    return {
      ...result,
      action: normalizedAction,
      issues: [],
    };
  } catch (error) {
    return {
      source: policySource,
      issues: [
        createIssue(input, {
          code: 'POLICY_THREW',
          severity: 'fail',
          step,
          playerID,
          phase: state.ctx.phase ?? null,
          stateHash: stateHash(state),
          message: `policy threw: ${(error as Error).message}`,
        }),
      ],
    };
  }
}

function currentActors(state: State): PlayerID[] {
  if (state.ctx.activePlayers) return Object.keys(state.ctx.activePlayers).sort();
  return [state.ctx.currentPlayer];
}

function pickWeightedAction(
  actions: WeightedHarnessAction[],
  seed: string,
): WeightedHarnessAction | undefined {
  if (actions.length === 0) return undefined;
  const totalWeight = actions.reduce((sum, action) => sum + (action.weight ?? 1), 0);
  const rand = alea(seed);
  let roll = rand() * totalWeight;
  for (const action of actions) {
    roll -= action.weight ?? 1;
    if (roll <= 0) return action;
  }
  return actions[actions.length - 1];
}

function pickUniformAction(
  actions: WeightedHarnessAction[],
  seed: string,
): WeightedHarnessAction | undefined {
  if (actions.length === 0) return undefined;
  const rand = alea(seed);
  return actions[Math.min(actions.length - 1, Math.floor(rand() * actions.length))];
}

function makeSeedFromContext(seed: string, step: number, playerID: string, state: State): string {
  return `${seed}:${step}:${playerID}:${state['_stateID']}`;
}

function toStepTrace(
  step: number,
  state: State,
  playerID: PlayerID,
  policyResult: HarnessPolicyResult & { action: WeightedHarnessAction },
): HarnessStepTrace {
  const action = policyResult.action;
  const args = action.payload.args ?? [];
  return {
    step,
    stateID: state['_stateID'],
    playerID,
    phase: state.ctx.phase ?? null,
    actionHash: stableHash({
      type: action.type,
      payload: {
        type: action.payload.type,
        args,
        playerID: action.payload.playerID ?? playerID,
      },
    }),
    actionType: action.type === GAME_EVENT ? 'event' : 'move',
    actionName: action.payload.type,
    argsHash: stableHash(args),
    argsPreview: previewValue(args),
    policySource: policyResult.source,
    policyStrength: policyResult.strength,
    policyElapsedMs: policyResult.elapsedMs,
  };
}

function toCoreBestMoveStrength(strength: HarnessPolicyStrength): 'medium' | 'strong' | undefined {
  return strength === 'weak' ? undefined : strength;
}

function createReducerIssue(
  input: HarnessCaseInput,
  params: {
    mode: HarnessMode;
    policySource: HarnessPolicyResult['source'];
    state: State;
    step: number;
    playerID: PlayerID;
    actionHash: string;
    error: ActionError;
  },
): HarnessIssue {
  const code: HarnessIssueCode =
    params.mode === 'fuzz-random' &&
    (params.policySource === 'enumerate-random' || params.policySource === 'uniform-random')
      ? 'ENUMERATED_ACTION_REJECTED'
      : 'POLICY_RETURNED_ILLEGAL_ACTION';
  return createIssue(input, {
    code,
    severity: 'fail',
    step: params.step,
    playerID: params.playerID,
    phase: params.state.ctx.phase ?? null,
    actionHash: params.actionHash,
    stateHash: stateHash(params.state),
    message: `Reducer rejected action with ${params.error.type}.`,
    data: { reducerError: params.error },
  });
}

function createReducerThrowIssue(
  input: HarnessCaseInput,
  params: {
    policySource: HarnessPolicyResult['source'];
    state: State;
    step: number;
    playerID: PlayerID;
    actionHash: string;
    error: unknown;
  },
): HarnessIssue {
  return createIssue(input, {
    code: 'REDUCER_THREW',
    severity: 'fail',
    step: params.step,
    playerID: params.playerID,
    phase: params.state.ctx.phase ?? null,
    actionHash: params.actionHash,
    stateHash: stateHash(params.state),
    message: `Reducer threw while applying action: ${(params.error as Error).message}`,
    data: {
      policySource: params.policySource,
      errorName: (params.error as Error).name,
      errorMessage: (params.error as Error).message,
    },
  });
}

function compareTraces(
  input: HarnessCaseInput,
  expected: HarnessCaseResult,
  actual: HarnessCaseResult,
): HarnessIssue | undefined {
  if (expected.trace.initialStateHash !== actual.trace.initialStateHash) {
    return createIssue(input, {
      code: 'NON_DETERMINISTIC_TRACE',
      severity: 'fail',
      step: 0,
      message: 'Same seed produced a different initial state.',
      data: {
        expectedInitialStateHash: expected.trace.initialStateHash,
        actualInitialStateHash: actual.trace.initialStateHash,
      },
    });
  }

  const expectedTerminal = {
    completed: expected.trace.terminal.completed,
    gameoverHash: expected.trace.terminal.gameoverHash,
    stepLimitReached: expected.trace.terminal.stepLimitReached,
  };
  const actualTerminal = {
    completed: actual.trace.terminal.completed,
    gameoverHash: actual.trace.terminal.gameoverHash,
    stepLimitReached: actual.trace.terminal.stepLimitReached,
  };
  const max = Math.max(expected.trace.steps.length, actual.trace.steps.length);
  for (let i = 0; i < max; i++) {
    const left = expected.trace.steps[i];
    const right = actual.trace.steps[i];
    if (stableHash(comparableStep(left)) !== stableHash(comparableStep(right))) {
      return createIssue(input, {
        code: 'NON_DETERMINISTIC_TRACE',
        severity: 'fail',
        step: i,
        message: 'Same seed produced a different action trace.',
        data: {
          firstDivergence: {
            expected: left ? previewStep(left) : null,
            actual: right ? previewStep(right) : null,
          },
        },
      });
    }
  }
  if (stableHash(expectedTerminal) !== stableHash(actualTerminal)) {
    return createIssue(input, {
      code: 'NON_DETERMINISTIC_TRACE',
      severity: 'fail',
      step: max,
      message: 'Same seed produced a different terminal result.',
      data: { expectedTerminal, actualTerminal },
    });
  }
  return undefined;
}

function comparableStep(
  step: HarnessStepTrace | undefined,
): Omit<HarnessStepTrace, 'policyElapsedMs'> | null {
  if (!step) return null;
  const { policyElapsedMs: _policyElapsedMs, ...comparable } = step;
  return comparable;
}

function previewStep(step: HarnessStepTrace) {
  return {
    step: step.step,
    playerID: step.playerID,
    actionType: step.actionType,
    actionName: step.actionName,
    argsHash: step.argsHash,
    argsPreview: step.argsPreview,
  };
}

function checkInvariants(
  input: HarnessCaseInput,
  game: Game,
  state: State,
  step: number,
  reproductionCommand: string,
): HarnessIssue[] {
  return checkHarnessInvariants({
    game,
    state,
    slug: input.slug,
    seed: input.seed,
    numPlayers: input.numPlayers,
    setupVariant: input.setupVariant,
    mode: input.mode ?? 'fuzz-random',
    maxSteps: input.maxSteps,
    step,
    reproductionCommand,
  });
}

function createIssue(
  input: HarnessCaseInput,
  params: Pick<HarnessIssue, 'code' | 'severity' | 'message'> &
    Partial<
      Pick<
        HarnessIssue,
        'step' | 'playerID' | 'phase' | 'actionHash' | 'stateHash' | 'data' | 'reproduction'
      >
    >,
): HarnessIssue {
  return {
    code: params.code,
    severity: params.severity,
    slug: input.slug,
    seed: input.seed,
    numPlayers: input.numPlayers,
    setupVariant: input.setupVariant,
    mode: input.mode ?? 'fuzz-random',
    maxSteps: input.maxSteps,
    step: params.step ?? 0,
    playerID: params.playerID,
    phase: params.phase,
    actionHash: params.actionHash,
    stateHash: params.stateHash,
    message: params.message,
    data: params.data,
    reproduction: params.reproduction ?? {
      command: input.reproductionCommand ?? 'pnpm --filter @boardoor/core test:run -- game-harness',
    },
  };
}

function dedupeIssues(issues: HarnessIssue[]): HarnessIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = stableHash({
      code: issue.code,
      severity: issue.severity,
      slug: issue.slug,
      seed: issue.seed,
      setupVariant: issue.setupVariant,
      step: issue.step,
      playerID: issue.playerID,
      phase: issue.phase,
      actionHash: issue.actionHash,
      stateHash: issue.stateHash,
      message: issue.message,
      data: issue.data,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
