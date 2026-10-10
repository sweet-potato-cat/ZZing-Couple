// 🔊 게임 효과음 — 소리 파일 없이 Web Audio 로 직접 만들어 (8bit 느낌 삐뽀·톡·뿅)
// 쓰는 법: import { sfx } from './games/sfx.js';
//          sfx.unlock()   ← 사용자가 버튼을 누르는 순간 한 번 (아이폰은 이래야 소리가 나)
//          sfx.play('ok') ← 이름은 아래 SOUNDS
// 끄기/켜기: sfx.setMuted(true/false) — 이 기기에 기억 (localStorage 'couple-sfx-off')
// ⚠️ 아이폰은 무음 모드(옆 스위치)면 안 들려 (iOS 규칙, 일부러 따름)
// 소리 크기는 MASTER, 소리 모양은 SOUNDS 에서 숫자(음 높이 Hz·길이 초)만 바꾸면 돼

const MASTER = 0.22;
const OFF_KEY = 'couple-sfx-off';
let ctx = null, master = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem(OFF_KEY) === '1'; } catch {}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch { return null; }
    master = ctx.createGain(); master.gain.value = MASTER; master.connect(ctx.destination);
  }
  return ctx;
}
// 삐- 하는 음 하나 (freq → to 로 미끄러질 수도)
function tone(freq, t0, dur, { type = 'square', vol = 1, to = null, attack = 0.005 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
// 쉬- 하는 바람/물 소리
function noise(t0, dur, { vol = 0.6, freq = 1200, to = null, q = 0.8, type = 'bandpass' } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.02);
}
const arp = (t, notes, gap, dur, opts) => notes.forEach((f, i) => tone(f, t + i * gap, Array.isArray(dur) ? dur[i] : dur, opts));

const SOUNDS = {
  tick: (t) => tone(660, t, 0.09, { vol: 0.5 }),                                   // 카운트다운 3·2·1
  go: (t) => tone(990, t, 0.2, { vol: 0.55 }),                                     // 시작!
  ok: (t) => arp(t, [880, 1320], 0.05, 0.08, { type: 'triangle', vol: 0.7 }),      // 맞힘 / 잡음 (삐뽀)
  perfect: (t) => arp(t, [1047, 1319, 1568], 0.045, 0.09, { type: 'triangle', vol: 0.6 }),
  bad: (t) => tone(260, t, 0.18, { vol: 0.45, to: 150 }),                          // 틀림 (뿌웅)
  miss: (t) => { tone(330, t, 0.12, { type: 'sawtooth', vol: 0.3, to: 220 }); tone(220, t + 0.11, 0.18, { type: 'sawtooth', vol: 0.3, to: 130 }); },
  push: (t) => tone(520, t, 0.04, { type: 'triangle', vol: 0.35, to: 420 }),       // 통나무 콕
  jump: (t) => tone(320, t, 0.14, { vol: 0.3, to: 760 }),                          // 뿅
  duck: (t) => tone(400, t, 0.08, { type: 'triangle', vol: 0.3, to: 220 }),
  pass: (t) => tone(1200, t, 0.05, { type: 'sine', vol: 0.25 }),                   // 장애물 넘음 (작게)
  throw: (t) => noise(t, 0.16, { vol: 0.25, freq: 600, to: 2400, q: 1.2 }),         // 휙
  bounce: (t) => tone(180, t, 0.08, { type: 'sine', vol: 0.6, to: 90 }),           // 통
  splash: (t) => { noise(t, 0.5, { vol: 0.6, freq: 900, to: 300, q: 0.6, type: 'lowpass' }); tone(140, t, 0.25, { type: 'sine', vol: 0.5, to: 60 }); },
  crash: (t) => { noise(t, 0.25, { vol: 0.6, freq: 500, to: 120, q: 0.7, type: 'lowpass' }); tone(120, t, 0.22, { vol: 0.35, to: 50 }); },
  stage: (t) => arp(t, [784, 1175], 0.09, [0.1, 0.16], { type: 'triangle', vol: 0.5 }),   // 새 단계 알림
  shuffle: (t) => arp(t, [700, 900, 700, 900], 0.06, 0.05, { type: 'triangle', vol: 0.3 }), // 부르르 (순서 바뀜 예고)
  combo: (t) => arp(t, [784, 988, 1175, 1568], 0.05, 0.08, { vol: 0.3 }),
  clear: (t) => arp(t, [659, 784, 1047], 0.08, [0.1, 0.1, 0.25], { vol: 0.35 }),  // 완주
  win: (t) => arp(t, [523, 659, 784, 1047], 0.11, [0.12, 0.12, 0.12, 0.4], { vol: 0.35 }), // 신기록 빰빰빰빠-
  over: (t) => arp(t, [523, 392, 330], 0.13, 0.16, { type: 'triangle', vol: 0.45 }),       // 끝 (또롱또롱)
};

const lastAt = {};
export const sfx = {
  get muted() { return muted; },
  setMuted(v) { muted = !!v; try { localStorage.setItem(OFF_KEY, muted ? '1' : '0'); } catch {} },
  // 사용자가 누르는 순간 불러 줘: 소리 장치 깨우기 (옛 아이폰은 무음 한 번 틀어야 깨어나)
  unlock() {
    const c = ac();
    if (!c) return;
    try {
      if (c.state === 'suspended') c.resume().catch(() => {});
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch {}
  },
  play(name) {
    if (muted || !SOUNDS[name]) return;
    const c = ac();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const now = c.currentTime;
    if (lastAt[name] && now - lastAt[name] < 0.03) return;   // 같은 소리가 한꺼번에 겹쳐 터지지 않게
    lastAt[name] = now;
    try { SOUNDS[name](now + 0.005); } catch {}
  },
};
