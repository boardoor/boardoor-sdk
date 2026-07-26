/** Noise burst ~50ms — card click sound. */
export function cardPlay(ctx: AudioContext, volume: number): void {
  const bufferSize = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2000;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume * 0.6, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.05);
}

/** Triple click 30ms apart — card dealing sound. */
export function cardDeal(ctx: AudioContext, volume: number): void {
  for (let i = 0; i < 3; i++) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.025);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < bufferSize; j++) {
      data[j] = (Math.random() * 2 - 1) * (1 - j / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;

    const gain = ctx.createGain();
    const offset = i * 0.03;
    const now = ctx.currentTime + offset;
    gain.gain.setValueAtTime(volume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.03);
  }
}

/** Filtered noise ~200ms — dice rattle sound. */
export function diceRoll(ctx: AudioContext, volume: number): void {
  const bufferSize = Math.floor(ctx.sampleRate * 0.2);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 3000;
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume * 0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.2);
}

/** Short mid-low knock — piece move / placement sound. */
export function pieceMove(ctx: AudioContext, volume: number): void {
  const body = ctx.createOscillator();
  const click = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  const clickGain = ctx.createGain();
  const now = ctx.currentTime;

  body.type = 'triangle';
  body.frequency.setValueAtTime(220, now);
  body.frequency.exponentialRampToValueAtTime(140, now + 0.12);
  bodyGain.gain.setValueAtTime(volume * 0.55, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

  click.type = 'square';
  click.frequency.setValueAtTime(900, now);
  clickGain.gain.setValueAtTime(volume * 0.16, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

  body.connect(bodyGain);
  click.connect(clickGain);
  bodyGain.connect(ctx.destination);
  clickGain.connect(ctx.destination);

  body.start(now);
  body.stop(now + 0.15);
  click.start(now);
  click.stop(now + 0.04);
}

/** Rising 2-note C5→E5 — trick win jingle. */
export function trickWin(ctx: AudioContext, volume: number): void {
  const notes = [523.25, 659.25]; // C5, E5
  const now = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const start = now + i * 0.1;
    gain.gain.setValueAtTime(volume * 0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    osc.start(start);
    osc.stop(start + 0.15);
  }
}

/** Rising 3-note C5-E5-G5 — victory fanfare. */
export function gameWin(ctx: AudioContext, volume: number): void {
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const now = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const start = now + i * 0.12;
    gain.gain.setValueAtTime(volume * 0.35, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
    osc.start(start);
    osc.stop(start + 0.25);
  }
}

/** Falling 2-note E4→C4 — defeat sound. */
export function gameLose(ctx: AudioContext, volume: number): void {
  const notes = [329.63, 261.63]; // E4, C4
  const now = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = notes[i];
    const start = now + i * 0.15;
    gain.gain.setValueAtTime(volume * 0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
    osc.start(start);
    osc.stop(start + 0.3);
  }
}
