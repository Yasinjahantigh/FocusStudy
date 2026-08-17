export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;

  private isBrownPlaying = false;
  private noiseVolumeTarget = 0.4;
  private masterVolume = 1;

  public setMasterVolume(vol: number) {
    this.masterVolume = Math.min(1, Math.max(0, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setNoiseVolume(vol: number) {
    this.noiseVolumeTarget = Math.min(1, Math.max(0, vol));
    if (this.noiseGain && this.ctx) {
      this.noiseGain.gain.setValueAtTime(this.noiseVolumeTarget, this.ctx.currentTime);
    }
  }

  public isNoisePlaying(): boolean {
    return this.isBrownPlaying;
  }

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public toggleBrownNoise(volume = 0.4): boolean {
    this.initCtx();
    if (!this.ctx || !this.masterGain) return false;

    if (this.isBrownPlaying && this.noiseNode) {
      try {
        this.noiseNode.stop();
      } catch {
        // already stopped
      }
      this.noiseNode.disconnect();
      this.noiseNode = null;
      this.noiseGain = null;
      this.isBrownPlaying = false;
      return false;
    }

    // Synthesize Brown Noise procedurally
    this.noiseVolumeTarget = Math.min(1, Math.max(0, volume));
    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.setValueAtTime(this.noiseVolumeTarget, this.ctx.currentTime);

    this.noiseNode.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    this.noiseNode.start();
    this.isBrownPlaying = true;
    return true;
  }

  public stopAll() {
    this.toggleBrownNoise(0);
  }
}

export const soundEngineSingleton = new SoundEngine();