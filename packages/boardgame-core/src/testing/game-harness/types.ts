import type { BotAction } from '../../ai/bot';
import type { ActionShape, Game, PlayerID, State } from '../../types';

export type HarnessMode = 'fuzz-random' | 'arena-strength' | 'trace-only';
export type HarnessIssueSeverity = 'fail' | 'warn';

export type HarnessIssueCode =
  | 'SETUP_THREW'
  | 'CASE_TIMEOUT'
  | 'NO_ENUMERATOR_OR_EMPTY_ENUMERATE_AT_STEP_0'
  | 'ENUMERATE_THREW'
  | 'ENUMERATE_RETURNED_INVALID_SHAPE'
  | 'ENUMERATE_MUTATED_STATE'
  | 'ENUMERATED_ACTION_REJECTED'
  | 'POLICY_RETURNED_ILLEGAL_ACTION'
  | 'REDUCER_THREW'
  | 'NO_LEGAL_ACTION_AND_NOT_GAMEOVER'
  | 'STEP_LIMIT_REACHED'
  | 'NON_DETERMINISTIC_TRACE'
  | 'STATE_HASH_DIVERGED'
  | 'STATE_NOT_JSON_SERIALIZABLE'
  | 'PLAYER_VIEW_THREW'
  | 'PLAYER_VIEW_MUTATED_STATE'
  | 'SAMPLE_HIDDEN_STATE_THREW'
  | 'SAMPLE_HIDDEN_STATE_MUTATED_STATE'
  | 'DOMAIN_INVARIANT_VIOLATED'
  | 'POLICY_THREW';

export interface HarnessIssue {
  code: HarnessIssueCode;
  severity: HarnessIssueSeverity;
  slug: string;
  seed: string;
  numPlayers: number;
  setupVariant: string;
  mode: HarnessMode;
  maxSteps: number;
  step: number;
  playerID?: string | null;
  phase?: string | null;
  actionHash?: string;
  stateHash?: string;
  message: string;
  data?: unknown;
  reproduction: {
    command: string;
    env?: Record<string, string>;
  };
}

export interface HarnessStepTrace {
  step: number;
  stateID: number;
  playerID: string;
  phase?: string | null;
  actionHash: string;
  actionType: 'move' | 'event';
  actionName: string;
  argsHash: string;
  argsPreview?: unknown;
  policySource?: HarnessPolicyResult['source'];
  policyStrength?: HarnessPolicyResult['strength'];
  policyElapsedMs?: number;
  gameoverHash?: string;
}

export interface HarnessPolicyResult {
  action?: BotAction;
  source:
    | 'enumerate-random'
    | 'uniform-random'
    | 'bestMove'
    | 'production-getBotMove'
    | 'mcts-fallback';
  strength?: 'weak' | 'medium' | 'strong';
  elapsedMs?: number;
  metadata?: unknown;
}

export type HarnessPolicy = (input: {
  game: Game;
  slug: string;
  state: State;
  playerID: PlayerID;
  seed: string;
  step: number;
}) => Promise<HarnessPolicyResult> | HarnessPolicyResult;

export type HarnessPolicyStrength = 'weak' | 'medium' | 'strong';

export interface BestMovePolicyOptions {
  defaultStrength?: HarnessPolicyStrength;
  strengths?: Record<string, HarnessPolicyStrength>;
}

export interface HarnessCaseInput {
  slug: string;
  game: Game;
  seed: string;
  numPlayers: number;
  setupVariant: string;
  setupData?: unknown;
  maxSteps: number;
  mode?: HarnessMode;
  policy?: HarnessPolicy;
  stepLimitSeverity?: HarnessIssueSeverity;
  determinismRetries?: number;
  onEnumerate?: (sample: HarnessEnumerateSample) => void;
  reproductionCommand?: string;
  engineVersion?: HarnessEngineVersion;
}

export interface HarnessEnumerateSample {
  stateHash: string;
  playerID: string;
  actionHashes: string[];
  totalActions: number;
  invalidActions: number;
}

export interface HarnessEngineVersion {
  commit?: string;
  boardgameCoreVersion?: string;
}

export interface HarnessMatchTrace {
  version: 1;
  slug: string;
  seed: string;
  numPlayers: number;
  setupVariant: string;
  setupDataHash: string;
  policies: Record<string, { name: string; strength?: string }>;
  engineVersion: HarnessEngineVersion;
  initialStateHash: string;
  steps: HarnessStepTrace[];
  terminal: {
    gameoverHash?: string;
    completed: boolean;
    stepLimitReached: boolean;
    stateHash: string;
  };
  issues: HarnessIssue[];
}

export interface HarnessCaseResult {
  version: 1;
  slug: string;
  seed: string;
  numPlayers: number;
  setupVariant: string;
  mode: HarnessMode;
  trace: HarnessMatchTrace;
  finalState?: State;
}

export type HarnessReportCaseResult = Omit<HarnessCaseResult, 'finalState'>;

export interface HarnessSummary {
  slug: string;
  cases: number;
  seeds: number;
  steps: number;
  completed: number;
  stepLimitReached: number;
  completionRate: number;
  failed: number;
  warned: number;
  issueCodes: Record<string, number>;
}

export interface HarnessReport {
  version: 1;
  generatedAt: string;
  summaries: HarnessSummary[];
  results: HarnessReportCaseResult[];
  issues: HarnessIssue[];
}

export type WeightedHarnessAction = BotAction & { weight?: number };

export type StateMigrationFixtureSource = 'synthetic' | 'owner-approved-anonymized-production';

export interface StateMigrationFixture<G = unknown> {
  name: string;
  source: StateMigrationFixtureSource;
  fromVersion: number;
  state: State<G>;
  expectedState: State<unknown>;
  /** Opt in only for the envelope-less 0 -> 1 current-shape compatibility case. */
  currentShapeNoOp?: boolean;
  scriptedActions?: ActionShape.Any[];
}

export type StateMigrationHarnessIssueCode =
  | 'SCHEMA_MISSING'
  | 'CHAIN_FAILED'
  | 'NON_DETERMINISTIC_MIGRATION'
  | 'MIGRATION_MUTATED_INPUT'
  | 'JSON_ROUND_TRIP_FAILED'
  | 'PROTOTYPE_KEY_REJECTED'
  | 'STATE_TOO_LARGE'
  | 'STEP_TIMEOUT'
  | 'CHAIN_TIMEOUT'
  | 'FIXTURE_MISMATCH'
  | 'CURRENT_SHAPE_NOT_NOOP'
  | 'PLAYER_VIEW_FAILED'
  | 'ENUMERATE_FAILED'
  | 'SCRIPTED_ACTION_REJECTED'
  | 'DOMAIN_INVARIANT_FAILED';

export interface StateMigrationHarnessIssue {
  code: StateMigrationHarnessIssueCode;
  fixture: string;
  message: string;
  data?: unknown;
}

export interface StateMigrationHarnessInput<G = unknown> {
  slug: string;
  game: Game<G>;
  numPlayers: number;
  fixtures: ReadonlyArray<StateMigrationFixture<G>>;
  maxStateBytes?: number;
  maxStepMs?: number;
  maxChainMs?: number;
}

export interface StateMigrationHarnessResult {
  slug: string;
  fixtures: number;
  issues: StateMigrationHarnessIssue[];
}
