// 🐻🐰 곰토 나누기 (타임어택) — 쌓여 있는 친구 200명을 누가 가장 빨리 다 나누나!
//   맨 아래(지금 차례, 동그라미 친) 친구가 토끼찡이면 ◀ 왼쪽, 곰돌찡이면 오른쪽 ▶
//   (아래 버튼 / 화면 왼쪽·오른쪽 터치 / 키보드 ←·→)
//   맞히면 그 친구가 날아가고 줄이 한 칸 내려와. 틀리면 친구는 그대로 + ⏱ 1초 벌칙
//   200명을 다 나누면 끝 → 걸린 시간이 기록 (짧을수록 좋음)
//   진행에 따라 어려워져 (시간이 아니라 "몇 명 나눴나" 기준 → 느린 사람이 더 어려워지지 않게)
//     0명~  : 2종 (🐰1·🐻1)        50명~ : 4종        100명~ : 6종         (STAGES)
//     75명~ : 😈 함정 "시러"(곰돌찡, 어둡게 표시) → 반대쪽 ◀ 왼쪽으로! 처음 나올 땐 "◀ 반대로!" 표시
//     150명~: 🔀 몇 초마다 위쪽 친구들(최대 4명)이 부르르 떨다가 순서가 바뀌어 (지금 차례·바로 다음은 안 건드림)
// 쓰는 법: const g = new SortGame(canvas, { happy, scared, bear: [img…], bunny: [img…], bg, trap });
//          const sec = await g.start();  g.pick(-1 | +1)
// 그림: bear/bunny 배열 앞에서부터 차례로 쓰여 (순서는 app.js 의 SORT_ORDER)

const HAND = '"Gaegu","Gowun Dodum",sans-serif';
export const SORT_TOTAL = 200;                                  // 몇 명 나누면 끝
const STAGES = [[0, 1], [50, 2], [100, 3]];                     // [몇 명 나눈 뒤부터, 캐릭터당 이모티콘 수] → 2종 / 4종 / 6종
const SIDE = { bunny: -1, bear: 1 };                            // 토끼찡 = 왼쪽, 곰돌찡 = 오른쪽
const TRAP_AT = 75, TRAP_P = 0.3;                               // 함정 "시러": 몇 명부터, 곰돌찡 중 몇 % (전체의 약 15%)
const TRAP_TINT = 'rgba(35,20,55,.4)';                          // 시러 어둡게 (마지막 숫자가 진하기)
const SHUF_AT = 150, SHUF_N = 4, SHUF_WARN = 0.45, SHUF_MOVE = 0.4;   // 순서 바꾸기: 몇 명부터, 몇 명, 흔들기·이동 시간(초)
const PENALTY = 1;                                              // 틀리면 몇 초 벌칙
const SLIDE = 0.08;                                             // 맞히고 줄이 한 칸 내려오는 시간(초) — 짧게 톡
const MAX_RUN = 4;                                              // 같은 친구가 연속으로 최대 몇 번
const BG_FADE = 0.8;                                            // 배경 만화 흐리게 (0 = 그대로, 1 = 안 보임)
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const ready = (img) => !!img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0));

export class SortGame {
  constructor(canvas, imgs, opts = {}) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.imgs = imgs || {};
    this.opts = opts;
    this.trapImg = this.darken(this.imgs.trap);
    this.state = 'idle';   // idle → count → play → end → over (pause 가능)
    this.raf = 0;
    this.reset();
    this.loop = this.loop.bind(this);
    this.onResize = () => { this.resize(); if (this.state !== 'play') this.draw(); };
    addEventListener('resize', this.onResize);
    this.resize();
  }
  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.onResize); this.state = 'idle'; }

  // 시러 그림을 미리 어둡게 칠해 둬 (투명한 바탕은 그대로, 캐릭터만 어둡게)
  darken(img) {
    if (!ready(img)) return img || null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = TRAP_TINT; g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  reset() {
    this.t = 0; this.cleared = 0; this.miss = 0; this.combo = 0; this.maxCombo = 0;
    this.flying = []; this.fx = [];
    this.off = 0; this.shakeT = 0; this.sadT = 0; this.happyT = 0; this.endT = 0; this.count = 0;
    this.stage = 0; this.trapSeen = false; this.shufWarn = null; this.nextShuf = 0; this.shufSaid = false;
    // 200명을 미리 쌓아 둬 (표정·함정은 화면에 처음 보일 때 정해 → 단계가 바뀌면 바로 새 얼굴)
    let last = null, run = 0;
    this.items = Array.from({ length: SORT_TOTAL }, () => {
      let k = Math.random() < 0.5 ? 'bear' : 'bunny';
      if (k === last && run >= MAX_RUN) k = k === 'bear' ? 'bunny' : 'bear';
      run = k === last ? run + 1 : 1; last = k;
      return { kind: k, v: null };
    });
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }
  // 화면 배치 (크기 바뀌어도 맞게). i번째 친구(0 = 맨 아래, 지금 차례) 위치는 baseY 에서 i칸 위
  get S() { return Math.max(56, Math.min((this.W || 360) * 0.25, (this.H || 500) * 0.135, 104)); }
  get gap() { return this.S * 1.12; }
  get lineY() { return (this.H || 500) * 0.8; }
  get baseY() { return this.lineY - this.S * 0.66; }
  yOfIdx(i) { return this.baseY - (i + this.off) * this.gap; }

  // 지금 단계에서 이 캐릭터가 쓸 수 있는 이모티콘 중 하나 (+ 75명부터 곰돌찡은 가끔 함정 시러)
  face(it) {
    if (it.v === null) {
      const n = Math.max(1, Math.min(STAGES[this.stage][1], (this.imgs[it.kind] || []).length));
      it.v = Math.floor(Math.random() * n);
      if (it.kind === 'bear' && this.cleared >= TRAP_AT && this.trapImg && Math.random() < TRAP_P) {
        it.trap = true;
        if (!this.trapSeen) { this.trapSeen = true; it.hint = true; this.fxText('😈 어두운 "시러"는 반대로!', this.W / 2, this.H * 0.3, '#E8696A', 1.3); }
      }
    }
    return it.v;
  }

  start() {
    cancelAnimationFrame(this.raf);
    this.resize(); this.reset();
    this.state = 'count'; this.count = 3;
    this.last = performance.now();
    return new Promise((res) => { this.done = res; this.raf = requestAnimationFrame(this.loop); });
  }
  pause() { if (this.state === 'play' || this.state === 'count') { this.paused = this.state; this.state = 'pause'; cancelAnimationFrame(this.raf); this.draw(); } }
  resume() { if (this.state === 'pause') { this.state = this.paused; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stop() { cancelAnimationFrame(this.raf); this.state = 'idle'; this.done = null; }

  // 고르기: -1 = 왼쪽(🐰 토끼찡), +1 = 오른쪽(🐻 곰돌찡)
  pick(side) {
    if (this.state !== 'play') return;
    const it = this.items[0];
    if (!it) return;
    this.face(it);
    const want = it.trap ? -SIDE[it.kind] : SIDE[it.kind];
    const y = this.yOfIdx(0);
    if (side !== want) {   // ❌ 친구는 그대로, 1초 벌칙
      this.t += PENALTY; this.miss++; this.combo = 0;
      this.sadT = 0.6; this.shakeT = 0.3; it.badT = 0.35;
      this.fxText(`+${PENALTY}초 💦`, this.W / 2, y - this.S * 0.75, '#4A90C8', 1.15);
      return;
    }
    this.items.shift();
    this.cleared++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.off = Math.min(2, this.off + 1);   // 줄이 한 칸 톡 내려와
    this.happyT = 0.25;
    this.flying.push({ ...it, x: this.W / 2, y, vx: side * this.W * 1.5, vy: -this.H * 0.45, rot: 0, vr: side * 7, t: 0 });
    if (this.combo % 25 === 0) this.fxText(`${this.combo}연속! 🔥`, this.W / 2, this.H * 0.22, '#E8696A', 1.3);
    // 단계 올리기 (몇 명 나눴나 기준)
    const st = STAGES.reduce((k, [at], i) => (this.cleared >= at ? i : k), 0);
    if (st > this.stage) { this.stage = st; this.fxText(`🎭 이제 ${STAGES[st][1] * 2}종류!`, this.W / 2, this.H * 0.3, '#4A90C8', 1.3); }
    if (this.cleared === SHUF_AT) { this.nextShuf = this.t + 1; this.fxText('🔀 이제 순서가 바뀌어!', this.W / 2, this.H * 0.3, '#4A90C8', 1.3); }
    if (this.cleared >= SORT_TOTAL) { this.state = 'end'; this.endT = 0; this.fxText('🎉 완주!', this.W / 2, this.H * 0.4, '#E8696A', 1.8); }
  }
  fxText(text, x, y, color, scale = 1) { this.fx.push({ text, x, y, color, scale, t: 0 }); }

  // 순서 바꿀 친구들: 화면에 보이는 위쪽 친구 최대 SHUF_N명 (지금 차례·바로 다음 친구는 빼서 억울하지 않게)
  shuffleCands() {
    const vis = this.items.slice(2, 9).filter((it, k) => this.yOfIdx(k + 2) > this.S * 0.45);
    const list = vis.slice(-SHUF_N);
    if (list.length < 2) return null;
    list.forEach((it) => this.face(it));
    const sig = (it) => `${it.kind}:${it.trap ? 't' : it.v}`;
    if (new Set(list.map(sig)).size < 2) return null;   // 다 똑같으면 바꿔도 티가 안 나
    return list;
  }
  doShuffle(list) {
    list = list.filter((it) => this.items.indexOf(it) >= 2);   // 그사이 아래로 내려왔으면 빼기
    if (list.length < 2) return;
    const sig = (it) => `${it.kind}:${it.trap ? 't' : it.v}`;
    const before = list.map(sig).join('|');
    const perm = list.map((_, i) => i);
    for (let k = 0; k < 12; k++) {   // 겉보기로 실제로 바뀌는 순서가 나올 때까지
      perm.sort(() => Math.random() - 0.5);
      if (perm.map((j) => sig(list[j])).join('|') !== before) break;
    }
    const content = list.map((it) => ({ kind: it.kind, v: it.v, trap: !!it.trap, hint: !!it.hint, idx: this.items.indexOf(it) }));
    list.forEach((it, i) => {
      const c = content[perm[i]], idx = this.items.indexOf(it);
      it.kind = c.kind; it.v = c.v; it.trap = c.trap; it.hint = c.hint;
      it.sw = c.idx === idx ? null : { dd: c.idx - idx, t: 0, dir: i % 2 ? 1 : -1 };
    });
  }

  loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.state === 'over') { const d = this.done; this.done = null; if (d) d(Math.round(this.t * 10) / 10); return; }
    if (this.state === 'count' || this.state === 'play' || this.state === 'end') this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.fx.forEach((f) => { f.t += dt; }); this.fx = this.fx.filter((f) => f.t < 0.9);
    this.flying.forEach((f) => { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += this.H * 2.6 * dt; f.rot += f.vr * dt; });
    this.flying = this.flying.filter((f) => f.t < 0.8);
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.sadT > 0) this.sadT -= dt;
    if (this.happyT > 0) this.happyT -= dt;
    if (this.off > 0) this.off = Math.max(0, this.off - dt / SLIDE);
    for (const it of this.items.slice(0, 10)) {
      if (it.badT > 0) it.badT -= dt;
      if (it.sw) { it.sw.t += dt; if (it.sw.t >= SHUF_MOVE) it.sw = null; }
    }
    if (this.state === 'count') { this.count -= dt; if (this.count <= 0) this.state = 'play'; return; }
    if (this.state === 'end') { this.endT += dt; if (this.endT > 1.1) this.state = 'over'; return; }
    if (this.state !== 'play') return;
    this.t += dt;
    // 150명부터: 위쪽 친구들 순서 바꾸기 (흔들기로 예고 → 자리 바꾸기)
    if (this.cleared < SHUF_AT) return;
    if (this.shufWarn) {
      this.shufWarn.t -= dt;
      if (this.shufWarn.t <= 0) { this.doShuffle(this.shufWarn.list); this.shufWarn = null; this.nextShuf = this.t + rand(2.5, 4); }
    } else if (this.t >= this.nextShuf) {
      const list = this.shuffleCands();
      if (list) this.shufWarn = { list, t: SHUF_WARN };
      else this.nextShuf = this.t + 0.5;
    }
  }

  drawChar(it, cx, cy, size) {
    const v = this.face(it), x = this.x;
    const img = it.trap ? this.trapImg : (this.imgs[it.kind] || [])[v] || (this.imgs[it.kind] || [])[0];
    if (ready(img)) { x.drawImage(img, cx - size / 2, cy - size / 2, size, size); return; }
    x.font = `${Math.round(size * 0.7)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(it.kind === 'bear' ? '🐻' : '🐰', cx, cy);
    x.textBaseline = 'alphabetic';
  }

  draw() {
    const { x, W, H } = this;
    if (!W) return;
    x.save();
    if (this.shakeT > 0) x.translate((Math.random() - 0.5) * 10 * this.shakeT / 0.3, 0);

    // 배경: 사이트 배경(3컷 만화)을 꽉 채우고 하얗게 덮어서 흐리게 → 친구들이 잘 보이게
    const bg = this.imgs.bg;
    x.fillStyle = '#F2FAEB'; x.fillRect(-10, 0, W + 20, H);
    if (ready(bg)) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), bw = bg.naturalWidth * s, bh = bg.naturalHeight * s;
      x.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      x.fillStyle = `rgba(255,255,255,${BG_FADE})`; x.fillRect(-10, 0, W + 20, H);
    }
    // 왼쪽 = 토끼찡 / 오른쪽 = 곰돌찡 바닥 (배경 만화랑 같은 방향)
    const S = this.S, ly = this.lineY, cx = W / 2;
    x.fillStyle = 'rgba(253,231,234,.9)'; x.fillRect(-10, ly, W / 2 + 10, H - ly);
    x.fillStyle = 'rgba(251,238,221,.9)'; x.fillRect(W / 2, ly, W / 2 + 10, H - ly);
    x.strokeStyle = 'rgba(31,31,31,.25)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, ly); x.lineTo(W, ly); x.stroke();
    x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(Math.max(17, W * 0.05))}px ${HAND}`; x.textBaseline = 'middle';
    x.textAlign = 'left'; x.fillText('◀ 🐰 토끼찡', 12, ly + (H - ly) / 2);
    x.textAlign = 'right'; x.fillText('곰돌찡 🐻 ▶', W - 12, ly + (H - ly) / 2);
    x.textBaseline = 'alphabetic';
    // 쌓여 있는 길
    x.fillStyle = 'rgba(255,255,255,.55)'; x.strokeStyle = 'rgba(31,31,31,.15)'; x.lineWidth = 2;
    x.beginPath(); x.roundRect ? x.roundRect(cx - S * 0.62, -20, S * 1.24, ly + 12, S * 0.3) : x.rect(cx - S * 0.62, -20, S * 1.24, ly + 12); x.fill(); x.stroke();

    // 쌓여 있는 친구들 (위에서부터) + 지금 차례 동그라미
    const warn = this.shufWarn ? new Set(this.shufWarn.list) : null;
    const top = Math.min(this.items.length - 1, Math.ceil(this.baseY / this.gap) + 2);
    for (let i = top; i >= 0; i--) {
      const it = this.items[i];
      let y = this.yOfIdx(i), ix = cx;
      if (it.sw) {   // 🔀 자리 바꾸는 중: 원래 자리에서 옆으로 휘어서 새 자리로
        const u = Math.min(1, it.sw.t / SHUF_MOVE);
        y -= it.sw.dd * this.gap * (1 - ease(u));
        ix += Math.sin(u * Math.PI) * S * 0.75 * it.sw.dir;
      } else if (warn && warn.has(it)) ix += Math.sin(this.t * 45) * 4;   // 곧 바뀜! 부르르
      if (it.badT > 0) ix += Math.sin(it.badT * 60) * 6;                  // 틀렸어! 도리도리
      if (y < -S) continue;
      if (i === 0 && this.state !== 'idle') {
        const bad = it.badT > 0;
        x.fillStyle = bad ? 'rgba(232,105,106,.22)' : 'rgba(255,179,71,.2)';
        x.strokeStyle = bad ? '#E8696A' : '#FFB347'; x.lineWidth = bad ? 4 : 3;
        x.beginPath(); x.arc(ix, y, S * 0.6, 0, 7); x.fill(); x.stroke();
        this.drawChar(it, ix, y, S * 1.06);
      } else {
        x.globalAlpha = 0.92; this.drawChar(it, ix, y, S * 0.9); x.globalAlpha = 1;
      }
      if (it.hint && it.trap && y > 80) {   // 처음 나온 시러: 반대로 보내라고 알려 주기 (점수판에 안 겹치게)
        x.fillStyle = '#E8696A'; x.font = `700 ${Math.round(Math.max(16, S * 0.22))}px ${HAND}`; x.textAlign = 'left';
        x.fillText('◀ 반대로!', ix + S * 0.62, y + 6);
      }
    }
    // 날아가는 친구 (고른 쪽으로 휙)
    for (const f of this.flying) {
      x.save(); x.globalAlpha = Math.max(0, 1 - f.t / 0.8);
      x.translate(f.x, f.y); x.rotate(f.rot);
      this.drawChar(f, 0, 0, S * 0.95);
      x.restore();
    }

    // 응원하는 강아지 (아래 가운데)
    const img = (this.sadT > 0 ? this.imgs.scared : this.imgs.happy) || this.imgs.happy;
    if (img) {
      const dh = Math.min((H - ly) * 0.92, 90), dw = dh * 200 / 214, hop = this.happyT > 0 ? Math.sin(this.happyT / 0.25 * Math.PI) * 5 : 0;
      x.drawImage(img, cx - dw / 2, H - dh - 2 - hop, dw, dh);
    }

    // ⏱ 시간 / 남은 친구 / 진행 막대
    x.textAlign = 'left'; x.fillStyle = '#1f1f1f';
    x.font = `700 ${Math.round(Math.max(24, W * 0.075))}px ${HAND}`;
    x.fillText(`⏱ ${this.t.toFixed(1)}초`, 12, 36);
    if (this.miss) { x.font = `700 16px ${HAND}`; x.fillStyle = '#4A90C8'; x.fillText(`실수 ${this.miss} (+${this.miss * PENALTY}초)`, 14, 58); }
    x.textAlign = 'right'; x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(Math.max(20, W * 0.06))}px ${HAND}`;
    x.fillText(`남은 ${SORT_TOTAL - this.cleared}`, W - 12, 36);
    const bw = W * 0.34, bx = W - 12 - bw, by = 46;
    x.fillStyle = 'rgba(31,31,31,.12)'; x.fillRect(bx, by, bw, 7);
    x.fillStyle = '#8E6CC9'; x.fillRect(bx, by, bw * (this.cleared / SORT_TOTAL), 7);
    x.strokeStyle = '#1f1f1f'; x.lineWidth = 1.5; x.strokeRect(bx, by, bw, 7);

    // 안내 글자
    x.textAlign = 'center';
    this.fx.forEach((f) => {
      x.globalAlpha = Math.max(0, 1 - f.t / 0.9);
      let fs = Math.round(22 * f.scale);
      x.font = `700 ${fs}px ${HAND}`;
      const tw = x.measureText(f.text).width;
      if (tw > W - 24) { fs = Math.floor(fs * (W - 24) / tw); x.font = `700 ${fs}px ${HAND}`; }   // 화면보다 길면 글씨 줄이기
      x.fillStyle = f.color;
      x.fillText(f.text, f.x, f.y - f.t * 40);
    });
    x.globalAlpha = 1;
    x.restore();

    if (this.state === 'count') {
      x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(W * 0.28)}px ${HAND}`; x.textAlign = 'center';
      x.fillText(String(Math.ceil(this.count)), W / 2, H * 0.45);
    }
    if (this.state === 'pause') { x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(0, 0, W, H); }
  }
}
