// 🐻🐰 곰토 나누기 — 위에서 한 줄로 내려오는 토끼찡·곰돌찡을 왼쪽/오른쪽으로 나누기
//   맨 아래(지금 차례, 동그라미 친) 친구가 토끼찡이면 ◀ 왼쪽, 곰돌찡이면 오른쪽 ▶
//   (아래 버튼 / 화면 왼쪽·오른쪽 터치 / 키보드 ←·→)
//   틀리거나, 못 누르고 빨간 선을 넘으면 ♥ 하나. ♥ 3개 다 잃으면 끝
//   빨리 고르면 줄이 쭉 내려와서 바로 다음 친구가 와 (기다릴 필요 없음)
//   맞히면 +1, 10콤보부터 x2, 20콤보부터 x3. 맞힐수록 빨라져
//   이모티콘 종류는 시간에 따라 늘어나: 처음 2종(🐰1·🐻1) → 20초 4종 → 40초 6종 (STAGES). 종류마다 이모티콘 하나로 고정
// 쓰는 법: const g = new SortGame(canvas, { happy, scared, bear: [img…], bunny: [img…], bg });
//          const score = await g.start();  g.pick(-1 | +1)
// 그림: bear/bunny 배열 앞에서부터 차례로 쓰여 (순서는 app.js 의 sortAssets 에서 정해)

const HAND = '"Gaegu","Gowun Dodum",sans-serif';
const STAGES = [[0, 1], [20, 2], [40, 3]];                      // [몇 초부터, 캐릭터당 이모티콘 수] → 2종 / 4종 / 6종
const SIDE = { bunny: -1, bear: 1 };                            // 토끼찡 = 왼쪽, 곰돌찡 = 오른쪽
const MAX_RUN = 4;                                              // 같은 친구가 연속으로 최대 몇 번
const intervalOf = (n) => Math.max(0.34, 0.95 - n * 0.012);     // 한 칸 내려오는 시간(초): 맞힐수록 짧아짐 (50개쯤 최고 속도)
const ready = (img) => img && img.complete && img.naturalWidth > 0;

export class SortGame {
  constructor(canvas, imgs, opts = {}) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.imgs = imgs || {};
    this.opts = opts;
    this.state = 'idle';   // idle → count → play → end → over (pause 가능)
    this.raf = 0;
    this.reset();
    this.loop = this.loop.bind(this);
    this.onResize = () => { this.resize(); if (this.state !== 'play') this.draw(); };
    addEventListener('resize', this.onResize);
    this.resize();
  }
  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.onResize); this.state = 'idle'; }

  reset() {
    this.t = 0; this.score = 0; this.combo = 0; this.maxCombo = 0; this.lives = 3; this.sorted = 0;
    this.items = []; this.flying = []; this.fx = [];
    this.rate = 1 / intervalOf(0);
    this.shakeT = 0; this.sadT = 0; this.happyT = 0; this.endT = 0; this.count = 0;
    this.lastKind = null; this.run = 0; this.stage = 0;
    this.fill();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }
  // 화면 배치 (크기 바뀌어도 맞게). 친구 위치는 "선에서 몇 칸 위(d)"로 저장 → 화면 크기와 상관없음
  get S() { return Math.max(56, Math.min((this.W || 360) * 0.27, (this.H || 500) * 0.15, 110)); }
  get gap() { return this.S * 1.12; }
  get lineY() { return (this.H || 500) * 0.8; }
  yOf(it) { return this.lineY - it.d * this.gap; }

  nextKind() {
    let k = Math.random() < 0.5 ? 'bear' : 'bunny';
    if (k === this.lastKind && this.run >= MAX_RUN) k = k === 'bear' ? 'bunny' : 'bear';
    this.run = k === this.lastKind ? this.run + 1 : 1;
    this.lastKind = k;
    return k;
  }
  // 위쪽 화면 밖까지 줄을 채워 둬 (맨 처음 친구는 선에서 2.6칸 위 → 2초 조금 넘게 여유)
  fill() {
    const top = this.lineY / this.gap + 1.2;
    const last = this.items[this.items.length - 1];
    let d = last ? last.d + 1 : 2.6;
    while (d < top) {
      this.items.push({ kind: this.nextKind(), v: null, d });   // 표정(v)은 화면에 처음 보일 때 정해 → 20초·40초에 바로 새 얼굴이 나와
      d += 1;
    }
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

  // 지금 단계에서 이 캐릭터가 쓸 수 있는 이모티콘 중 하나
  face(it) {
    if (it.v === null) {
      const n = Math.max(1, Math.min(STAGES[this.stage][1], (this.imgs[it.kind] || []).length));
      it.v = Math.floor(Math.random() * n);
    }
    return it.v;
  }
  // 고르기: -1 = 왼쪽(🐰 토끼찡), +1 = 오른쪽(🐻 곰돌찡)
  pick(side) {
    if (this.state !== 'play') return;
    if (!this.items[0] || this.yOf(this.items[0]) < this.S * 0.5) return;   // 아직 화면에 안 내려온 친구는 못 골라
    const it = this.items.shift();
    this.face(it);
    const want = SIDE[it.kind], ok = side === want, y = this.yOf(it);
    this.flying.push({ ...it, x: this.W / 2, y, vx: side * this.W * 1.5, vy: -this.H * 0.45, rot: 0, vr: side * 7, t: 0, ok });
    if (ok) {
      this.sorted++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      const mul = Math.min(3, 1 + Math.floor(this.combo / 10));   // 10콤보마다 x2, 20콤보부터 x3
      this.score += mul;
      this.happyT = 0.3;
      this.fxText(`+${mul}`, this.W * (side < 0 ? 0.24 : 0.76), y - this.S * 0.4, '#E8696A');
      if (this.combo % 10 === 0) this.fxText(`${this.combo} 콤보! x${mul} 🔥`, this.W / 2, this.H * 0.2, '#E8696A', 1.4);
    } else {
      this.miss(y, '반대야! 💦');
    }
    this.fill();
  }
  miss(y, text) {
    this.lives--; this.combo = 0; this.sadT = 0.7; this.shakeT = 0.3;
    this.fxText(text, this.W / 2, Math.max(this.H * 0.18, y - this.S * 0.7), '#4A90C8', 1.15);
    if (this.lives <= 0) { this.state = 'end'; this.endT = 0; }
  }
  fxText(text, x, y, color, scale = 1) { this.fx.push({ text, x, y, color, scale, t: 0 }); }

  loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.state === 'over') { const d = this.done; this.done = null; if (d) d(this.score); return; }
    if (this.state === 'count' || this.state === 'play' || this.state === 'end') this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.fx.forEach((f) => { f.t += dt; }); this.fx = this.fx.filter((f) => f.t < 0.9);
    this.flying.forEach((f) => { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += this.H * 2.6 * dt; f.rot += f.vr * dt; });
    this.flying = this.flying.filter((f) => f.t < 0.8);
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.sadT > 0) this.sadT -= dt;
    if (this.happyT > 0) this.happyT -= dt;
    if (this.state === 'count') { this.count -= dt; if (this.count <= 0) this.state = 'play'; return; }
    if (this.state === 'end') { this.endT += dt; if (this.endT > 0.9) this.state = 'over'; return; }
    if (this.state !== 'play') return;
    this.t += dt;
    // 20초·40초: 이모티콘 종류 늘리기
    const st = STAGES.reduce((k, [at], i) => (this.t >= at ? i : k), 0);
    if (st > this.stage) { this.stage = st; this.fxText(`🎭 이제 ${STAGES[st][1] * 2}종류!`, this.W / 2, this.H * 0.28, '#4A90C8', 1.3); }
    // 속도는 부드럽게 따라가 (갑자기 휙 빨라지지 않게)
    this.rate += (1 / intervalOf(this.sorted) - this.rate) * Math.min(1, dt * 1.5);
    // 빨리 골라서 맨 아래가 비면 줄이 쭉 내려와서 채워 (기다리지 않게). 압박은 기본 속도(rate)가 담당
    const lead = this.items[0] ? this.items[0].d : 0, catchUp = Math.max(0, lead - 1.4) * 7;
    for (const it of this.items) it.d -= (this.rate + catchUp) * dt;
    const first = this.items[0];
    if (first && first.d <= 0) {   // 못 누르고 선을 넘음 → 아래로 툭 떨어짐
      this.items.shift(); this.face(first);
      this.flying.push({ ...first, x: this.W / 2, y: this.lineY, vx: 0, vy: this.H * 0.2, rot: 0, vr: 0, t: 0, ok: false });
      this.miss(this.lineY, '놓쳤어! 💦');
    }
    this.fill();
  }

  drawChar(it, cx, cy, size) {
    const x = this.x, img = (this.imgs[it.kind] || [])[this.face(it)] || (this.imgs[it.kind] || [])[0];
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

    // 배경: 사이트 배경(3컷 만화)을 꽉 채우고 하얗게 살짝 덮기 → 내려오는 친구가 잘 보이게
    const bg = this.imgs.bg;
    x.fillStyle = '#F2FAEB'; x.fillRect(-10, 0, W + 20, H);
    if (ready(bg)) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), bw = bg.naturalWidth * s, bh = bg.naturalHeight * s;
      x.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      x.fillStyle = 'rgba(255,255,255,.62)'; x.fillRect(-10, 0, W + 20, H);
    }
    // 왼쪽 = 토끼찡 / 오른쪽 = 곰돌찡 바닥 색 (배경 만화랑 같은 방향)
    const S = this.S, ly = this.lineY, cx = W / 2;
    x.fillStyle = 'rgba(253,231,234,.85)'; x.fillRect(-10, ly, W / 2 + 10, H - ly);
    x.fillStyle = 'rgba(251,238,221,.85)'; x.fillRect(W / 2, ly, W / 2 + 10, H - ly);
    x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(Math.max(17, W * 0.05))}px ${HAND}`; x.textBaseline = 'middle';
    x.textAlign = 'left'; x.fillText('◀ 🐰 토끼찡', 12, ly + (H - ly) / 2);
    x.textAlign = 'right'; x.fillText('곰돌찡 🐻 ▶', W - 12, ly + (H - ly) / 2);
    x.textBaseline = 'alphabetic';
    // 내려오는 길 + 빨간 선
    x.fillStyle = 'rgba(255,255,255,.5)'; x.strokeStyle = 'rgba(31,31,31,.18)'; x.lineWidth = 2;
    x.beginPath(); x.roundRect ? x.roundRect(cx - S * 0.62, -20, S * 1.24, ly + 20, S * 0.3) : x.rect(cx - S * 0.62, -20, S * 1.24, ly + 20); x.fill(); x.stroke();
    x.setLineDash([8, 7]); x.strokeStyle = '#E8696A'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, ly); x.lineTo(W, ly); x.stroke(); x.setLineDash([]);

    // 내려오는 친구들 (위에서부터) + 지금 차례 동그라미
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], y = this.yOf(it);
      if (y < -S) continue;
      if (i === 0 && this.state !== 'idle') {
        const danger = it.d < 0.7;
        x.fillStyle = danger ? 'rgba(232,105,106,.18)' : 'rgba(255,179,71,.2)';
        x.strokeStyle = danger ? '#E8696A' : '#FFB347'; x.lineWidth = danger ? 4 : 3;
        x.beginPath(); x.arc(cx, y, S * 0.6, 0, 7); x.fill(); x.stroke();
        this.drawChar(it, cx, y, S * 1.06);
      } else {
        x.globalAlpha = 0.92; this.drawChar(it, cx, y, S * 0.9); x.globalAlpha = 1;
      }
    }
    // 날아가는 친구 (맞으면 그쪽으로 휙, 틀리면 ✖)
    for (const f of this.flying) {
      x.save(); x.globalAlpha = Math.max(0, 1 - f.t / 0.8);
      x.translate(f.x, f.y); x.rotate(f.rot);
      this.drawChar(f, 0, 0, S * 0.95);
      if (!f.ok) {
        x.strokeStyle = '#E8696A'; x.lineWidth = 6; x.lineCap = 'round';
        x.beginPath(); x.moveTo(-S * 0.3, -S * 0.3); x.lineTo(S * 0.3, S * 0.3); x.moveTo(S * 0.3, -S * 0.3); x.lineTo(-S * 0.3, S * 0.3); x.stroke();
      }
      x.restore();
    }

    // 응원하는 강아지 (아래 가운데)
    const img = (this.sadT > 0 || this.state === 'end' ? this.imgs.scared : this.imgs.happy) || this.imgs.happy;
    if (img) {
      const dh = Math.min((H - ly) * 0.92, 90), dw = dh * 200 / 214, hop = this.happyT > 0 ? Math.sin(this.happyT / 0.3 * Math.PI) * 6 : 0;
      x.drawImage(img, cx - dw / 2, H - dh - 2 - hop, dw, dh);
    }

    // 점수 / 콤보 / 목숨
    x.textAlign = 'left'; x.fillStyle = '#1f1f1f';
    x.font = `700 ${Math.round(Math.max(24, W * 0.075))}px ${HAND}`;
    x.fillText(`${this.score}점`, 14, 38);
    if (this.combo >= 2) { x.font = `700 18px ${HAND}`; x.fillStyle = '#E8696A'; x.fillText(`${this.combo} 콤보`, 16, 62); }
    x.textAlign = 'right'; x.fillStyle = '#1f1f1f'; x.font = `${Math.round(Math.max(20, W * 0.06))}px sans-serif`;
    x.fillText('❤️'.repeat(Math.max(0, this.lives)) + '🤍'.repeat(Math.max(0, 3 - this.lives)), W - 12, 38);

    // 판정 글자
    x.textAlign = 'center';
    this.fx.forEach((f) => {
      x.globalAlpha = Math.max(0, 1 - f.t / 0.9);
      x.fillStyle = f.color; x.font = `700 ${Math.round(22 * f.scale)}px ${HAND}`;
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
