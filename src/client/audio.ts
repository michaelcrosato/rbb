/** Procedural effects: no downloads, licensed assets, or autoplay before user interaction. */
export class GameAudio {
  private context?: AudioContext;
  volume = 0.35;
  async unlock(): Promise<void> {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch {
      /* Sound is optional. */
    }
  }
  play(kind: 'gather' | 'craft' | 'build' | 'damage' | 'consume' | 'loot' | 'death'): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.volume <= 0) return;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const frequencies = {
      gather: 170,
      craft: 520,
      build: 95,
      damage: 65,
      consume: 360,
      loot: 660,
      death: 55,
    };
    oscillator.type = kind === 'gather' || kind === 'damage' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequencies[kind], context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequencies[kind] * (kind === 'craft' ? 1.6 : 0.45),
      context.currentTime + 0.13,
    );
    gain.gain.setValueAtTime(this.volume * 0.15, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  dispose(): void {
    void this.context?.close();
  }
}
