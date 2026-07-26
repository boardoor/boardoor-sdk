import type { Operation } from 'rfc6902';

import type { ChatMessage, FilteredMetadata, LogEntry, State, SyncInfo } from '../types';

/** Data types shared by the server-side and client-side transport payloads. */
export type CommonTransportData =
  | { type: 'sync'; args: [string, SyncInfo] }
  | { type: 'matchData'; args: [string, FilteredMetadata] }
  | { type: 'chat'; args: [string, ChatMessage] };

/** Final payload shape received by clients and client transports. */
export type TransportData =
  | { type: 'update'; args: [string, State, LogEntry[]] }
  | { type: 'patch'; args: [string, number, number, Operation[], LogEntry[]] }
  | CommonTransportData;

/** Payload emitted by a master before applying a player-specific view. */
export type IntermediateTransportData =
  | { type: 'update'; args: [string, State] }
  | { type: 'patch'; args: [string, number, State, State] }
  | CommonTransportData;
