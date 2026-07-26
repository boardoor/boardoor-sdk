import { useEffect, useRef } from 'react';

import type { AudioSettings, GameSoundManager, SoundEffect } from './game-sounds';
import { createGameSoundManager } from './game-sounds';

/**
 * React hook that provides a `playSound` function for game sound effects.
 * Listens for `audioSettingsUpdate` postMessage from the shell to update volumes.
 */
export function useGameSounds(): { playSound: (effect: SoundEffect) => void } {
  const managerRef = useRef<GameSoundManager | null>(null);

  if (!managerRef.current) {
    managerRef.current = createGameSoundManager();
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (
        typeof data === 'object' &&
        data !== null &&
        data.type === 'audioSettingsUpdate' &&
        data.audioSettings
      ) {
        managerRef.current?.updateSettings(data.audioSettings);
      }
    }
    function handleInternalSettings(event: Event) {
      managerRef.current?.updateSettings((event as CustomEvent<AudioSettings>).detail);
    }
    window.addEventListener('message', handleMessage);
    window.addEventListener('boardoor:audio-settings', handleInternalSettings);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('boardoor:audio-settings', handleInternalSettings);
    };
  }, []);

  return {
    playSound: (effect: SoundEffect) => {
      managerRef.current?.play(effect);
    },
  };
}
