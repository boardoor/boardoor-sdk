// Game definitions
export type { Game, FnContext, MoveFn, PhaseConfig } from './types';
export type { State, Ctx, LogEntry, PlayerID, Server } from './types';
export type {
  AiEnumerate,
  DomainInvariantContext,
  DomainInvariantViolation,
  ShareResult,
  ActionShape,
  CredentialedActionShape,
  FilteredMetadata,
  SyncInfo,
  ChatMessage,
} from './types';
export { INVALID_MOVE } from './core/constants';
export { TurnOrder, ActivePlayers } from './core/turn-order';

// Engine
export { MAKE_MOVE, REDO, UNDO } from './core/action-types';
export { IsLongFormMove, ProcessGameConfig } from './core/game';
export { getFilterPlayerView, redactLog } from './core/filter-player-view';
export { InitializeGame } from './core/initialize';
export { CreateGameReducer, TransientHandlingMiddleware } from './core/reducer';

// Protocol
export type { IntermediateTransportData, TransportData } from './core/transport-data';

// State migration
export {
  applyStateMigrations,
  StateMigrationError,
  type ApplyStateMigrationsOptions,
  type ApplyStateMigrationsResult,
  type StateMigrationErrorCode,
} from './core/state-migrations';

export type {
  GameLogAudience,
  GameLogDelta,
  GameLogEntry,
  GameLogLevel,
  GameLogMessageParam,
  GameLogStateShape,
  ResolvedGameLogEntry,
} from './game-log';
export {
  appendGameLog,
  extractGameLogDelta,
  filterGameLogForPlayer,
  gameLogMessageParam,
  resolveGameLogText,
  resolveGameLogs,
} from './game-log';
export {
  CURRENT_REPLAY_ENGINE_STATE_VERSION,
  REPLAY_INDEX_STATUSES,
  parseReplayPackage,
  REPLAY_PACKAGE_VERSION,
  serializeReplayPackage,
  validateReplayPackage,
} from './replay';
export type {
  ReplayAccessPolicy,
  ReplayIndexRecord,
  ReplayIndexStatus,
  ReplayManifest,
  ReplayPackage,
  ReplayParticipant,
  ReplayRecordingMode,
  ReplayReleaseIdentity,
  ReplayStep,
  ReplayValidationResult,
  ReplayVisibilityMode,
} from './replay';
export { buildReplayPackage, createReplayRecorder } from './replay-recorder';
export type {
  ReplayGameLogDeltaMetadata,
  ReplayGameLogTruncationMetadata,
  ReplayRecordedPackage,
  ReplayRecordedStep,
  ReplayRecorder,
  ReplayRecorderAppendInput,
  ReplayRecorderBuildOptions,
  ReplayRecorderMetadata,
} from './replay-recorder';

// Client (test & frontend)
export { Client } from './client/client';
export { Local } from './client/transport/local';
export { Remote } from './client/transport/websocket';
export { Transport } from './client/transport/transport';

// AI
export { Bot, RandomBot, MCTSBot, DeterminizedBot, Step, Simulate } from './ai';
export type { BotAction, WeightedBotAction, Node } from './ai';
export {
  DEFAULT_AI_MOVE_DELAY_MS,
  getRemainingAIMoveDelayMs,
  resolveAIMoveDelayMs,
} from './ai/move-delay';
export type { AIMoveDelayAction } from './ai/move-delay';

// Testing
export { MockRandom } from './testing/index';
