/**
 * 音效：用 WebAudio 程序化合成，不依赖任何音频素材文件。
 * 浏览器要求首次用户手势后才能播放，故在首次交互时解锁。
 */
const MUTE_KEY = "jhd.mute";

type ThemeTint = "jade" | "jilan" | "mohong";

class Sfx {
  private ctx: AudioContext | null = null;
  private bgmTimer = 0;
  private bgmStep = 0;
  private theme: ThemeTint = "jade";
  muted = localStorage.getItem(MUTE_KEY) === "1";

  setTheme(id: string): void {
    if (id === "jilan" || id === "jade" || id === "mohong") this.theme = id;
    else if (id === "anime") this.theme = "jilan";
  }

  private pitch(): number {
    if (this.theme === "jilan") return 1.04;
    if (this.theme === "mohong") return 0.92;
    return 1;
  }

  /** 在任意用户手势中调用以解锁音频 */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    if (this.muted) this.stopBgm();
    else this.startBgm();
    return this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0
  ): void {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * this.pitch(), t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  /** 出牌：短促的纸牌摩擦声（噪声爆发） */
  playCard(gain = 0.18): void {
    if (this.muted || !this.ctx) return;
    const dur = 0.09;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * dur, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = buf;
    filter.type = "highpass";
    filter.frequency.value =
      this.theme === "jilan" ? 1800 : this.theme === "mohong" ? 1300 : 1600;
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start();
  }

  /** 切主题轻提示音 */
  themeSwitch(): void {
    if (this.theme === "jilan") {
      this.tone(523, 0.1, "sine", 0.045);
      this.tone(784, 0.14, "triangle", 0.04, 0.06);
    } else if (this.theme === "mohong") {
      this.tone(392, 0.12, "triangle", 0.05);
      this.tone(494, 0.16, "sine", 0.04, 0.07);
    } else {
      this.tone(523, 0.1, "triangle", 0.05);
      this.tone(659, 0.12, "triangle", 0.04, 0.05);
    }
  }

  private noiseBurst(dur: number, gain: number, delay = 0): void {
    if (this.muted || !this.ctx) return;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.max(1, rate * dur), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 1.6;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = buf;
    filter.type = "bandpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.7;
    const t0 = this.ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** 洗牌：连续短促搓牌声 */
  dealShuffle(): void {
    if (this.muted || !this.ctx) return;
    const n = 11;
    for (let i = 0; i < n; i++)
      this.noiseBurst(0.055, 0.1 - i * 0.003, i * 0.075);
    this.tone(196, 0.35, "triangle", 0.025);
  }

  /** 发牌轮：轻快落牌 */
  dealRound(): void {
    this.playCard(0.11);
    this.tone(520, 0.05, "triangle", 0.035);
  }

  /** 桌面开牌：翻牌 + 连发 */
  dealTable(): void {
    this.tone(360, 0.07, "square", 0.03);
    this.tone(540, 0.09, "triangle", 0.04, 0.04);
    for (let i = 0; i < 4; i++) this.playCard(0.07 + i * 0.008);
  }

  /** 弃牌落桌：更低沉的放置音 */
  discard(): void {
    this.playCard();
    this.tone(180, 0.14, "triangle", 0.06);
  }

  /** 吃牌：清脆双音；高分牌额外加一段上行琶音 */
  capture(score: number): void {
    this.tone(880, 0.12, "triangle", 0.1);
    this.tone(1320, 0.16, "triangle", 0.08, 0.06);
    if (score >= 20) {
      this.tone(1046, 0.14, "sine", 0.09, 0.16);
      this.tone(1318, 0.14, "sine", 0.09, 0.24);
      this.tone(1568, 0.28, "sine", 0.1, 0.32);
    }
    if (score >= 30) {
      this.tone(1760, 0.2, "sine", 0.08, 0.4);
      this.tone(2093, 0.28, "sine", 0.07, 0.5);
    }
  }

  /** 翻牌吃牌：略带翻页感再接吃牌音 */
  flipCapture(score: number): void {
    this.tone(420, 0.08, "square", 0.04);
    this.tone(620, 0.1, "triangle", 0.05, 0.05);
    this.capture(score);
  }

  /** 轮到自己 */
  turn(): void {
    this.tone(660, 0.18, "sine", 0.07);
  }

  /** 结算 */
  roundOver(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, 0.3, "sine", 0.08, i * 0.12)
    );
  }

  // ---------- 背景音乐 ----------

  /**
   * 五声音阶随机行进 + 低八度铺底，同样为程序合成。
   * 音量刻意压得比音效低，不抢吃牌提示。
   */
  startBgm(): void {
    if (this.muted || !this.ctx || this.bgmTimer) return;
    const tick = () => {
      this.bgmNote();
      const gap = this.bgmStep % 32 < 16 ? 1500 : 1900;
      this.bgmTimer = window.setTimeout(tick, gap);
    };
    tick();
  }

  stopBgm(): void {
    clearTimeout(this.bgmTimer);
    this.bgmTimer = 0;
  }

  private bgmNote(): void {
    const jadeA = [261.63, 293.66, 329.63, 392.0, 440.0];
    const jadeB = [293.66, 329.63, 392.0, 440.0, 523.25];
    const jilanA = [293.66, 349.23, 392.0, 440.0, 523.25];
    const jilanB = [329.63, 392.0, 466.16, 523.25, 587.33];
    const mohongA = [220.0, 246.94, 293.66, 349.23, 392.0];
    const mohongB = [246.94, 293.66, 329.63, 392.0, 440.0];
    const pair =
      this.theme === "jilan"
        ? [jilanA, jilanB]
        : this.theme === "mohong"
        ? [mohongA, mohongB]
        : [jadeA, jadeB];
    const scale = this.bgmStep % 32 < 16 ? pair[0] : pair[1];
    const f = scale[Math.floor(Math.random() * scale.length)];
    this.pad(f, 2.8, 0.03);
    if (this.bgmStep % 4 === 0) this.pad(f / 2, 5, 0.022);
    if (this.bgmStep % 32 === 16) this.pad(196.0, 4.5, 0.018);
    this.bgmStep++;
  }

  /** 长淡入淡出的柔和长音，经低通滤掉刺耳高频 */
  private pad(freq: number, dur: number, gain: number): void {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(filter).connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
}

export const sfx = new Sfx();
