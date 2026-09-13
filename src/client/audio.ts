/** Procedural effects: no downloads, licensed assets, or autoplay before user interaction. */
export class GameAudio {
  private context?: AudioContext;
  private ambientSource?: AudioBufferSourceNode;
  private windGain?: GainNode;
  private rainGain?: GainNode;
  private noise?: AudioBuffer;
  private lastThunder = -100;
  volume = 0.35;
  async unlock(): Promise<void> {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      if (!this.ambientSource) {
        const c = this.context,
          buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
          data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
        this.ambientSource = c.createBufferSource();
        this.ambientSource.buffer = buffer;
        this.ambientSource.loop = true;
        const wind = c.createBiquadFilter();
        wind.type = 'lowpass';
        wind.frequency.value = 350;
        const rain = c.createBiquadFilter();
        rain.type = 'highpass';
        rain.frequency.value = 1800;
        this.windGain = c.createGain();
        this.rainGain = c.createGain();
        this.windGain.gain.value = this.rainGain.gain.value = 0;
        this.ambientSource.connect(wind);
        wind.connect(this.windGain);
        this.windGain.connect(c.destination);
        this.ambientSource.connect(rain);
        rain.connect(this.rainGain);
        this.rainGain.connect(c.destination);
        this.ambientSource.start();
      }
    } catch {
      /* Sound is optional. */
    }
  }
  environment(wind: number, rain: number, flash: number, active: boolean): void {
    const c = this.context;
    if (!c || c.state !== 'running') return;
    this.windGain?.gain.setTargetAtTime(active ? wind * this.volume * 0.06 : 0, c.currentTime, 0.3);
    this.rainGain?.gain.setTargetAtTime(active ? rain * this.volume * 0.08 : 0, c.currentTime, 0.3);
    if (active && flash > 0 && c.currentTime - this.lastThunder > 3 && this.noise) {
      this.lastThunder = c.currentTime;
      const source = c.createBufferSource(),
        filter = c.createBiquadFilter(),
        gain = c.createGain();
      source.buffer = this.noise;
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      gain.gain.setValueAtTime(this.volume * 0.55, c.currentTime + 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 2.6);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      source.start(c.currentTime + 0.7);
      source.stop(c.currentTime + 2.65);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
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
