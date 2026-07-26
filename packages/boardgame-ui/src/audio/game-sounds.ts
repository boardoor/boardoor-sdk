import * as synth from './synth';

export type SoundEffect =
  | 'cardPlay'
  | 'cardDeal'
  | 'diceRoll'
  | 'pieceMove'
  | 'trickWin'
  | 'gameWin'
  | 'gameLose';

export interface AudioSettings {
  master: { muted: boolean; volume: number };
  notification: { muted: boolean; volume: number };
  se: { muted: boolean; volume: number };
}

export interface GameSoundManager {
  play(effect: SoundEffect): void;
  updateSettings(settings: AudioSettings): void;
}

const SYNTH_MAP: Record<SoundEffect, (ctx: AudioContext, vol: number) => void> = {
  cardPlay: synth.cardPlay,
  cardDeal: synth.cardDeal,
  diceRoll: synth.diceRoll,
  pieceMove: synth.pieceMove,
  trickWin: synth.trickWin,
  gameWin: synth.gameWin,
  gameLose: synth.gameLose,
};

const THROTTLE_MS = 50;

export function createGameSoundManager(initialSettings?: AudioSettings): GameSoundManager {
  let audioCtx: AudioContext | null = null;
  let settings: AudioSettings = initialSettings ?? {
    master: { muted: false, volume: 0.5 },
    notification: { muted: false, volume: 0.5 },
    se: { muted: false, volume: 0.5 },
  };
  const lastPlayTime: Partial<Record<SoundEffect, number>> = {};

  function getCtx(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function getEffectiveVolume(): number {
    if (settings.master.muted || settings.se.muted) return 0;
    return settings.master.volume * settings.se.volume;
  }

  return {
    play(effect: SoundEffect): void {
      const vol = getEffectiveVolume();
      if (vol <= 0) return;

      // Throttle same-effect repeated plays
      const now = performance.now();
      const last = lastPlayTime[effect];
      if (last !== undefined && now - last < THROTTLE_MS) return;
      lastPlayTime[effect] = now;

      try {
        const ctx = getCtx();
        if (ctx.state === 'running') {
          SYNTH_MAP[effect](ctx, vol);
        }
      } catch {
        // Audio unavailable
      }
    },

    updateSettings(newSettings: AudioSettings): void {
      settings = newSettings;
    },
  };
}
