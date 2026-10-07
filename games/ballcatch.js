// ⚾ 공 받기 — 공이 날아와서 동그라미에 딱 들어오는 순간 콕! (타이밍 게임)
//   줄어드는 동그라미가 가운데 동그라미랑 딱 겹칠 때 누르면 Perfect, 조금 빗나가면 Good.
//   놓치면 ♥ 하나 잃고, ♥ 3개를 다 잃으면 끝. 연속으로 잡으면 콤보 보너스.
//   점점 빨리, 자주 날아오고 높게(포물선)·빠르게(직선)·한 번 튀기는 공이 섞여.
// 쓰는 법: const g = new BallGame(canvas, { happy, scared }, { thrower: '🐰' });  const score = await g.start();  g.tap()

// 판정 구간(초): 처음엔 넉넉하다가 공이 많아질수록 좁아져
const perfectOf = (n) => Math.max(0.05, 0.07 - n * 0.0006);
const goodOf = (n) => Math.max(0.105, 0.16 - n * 0.0016);
const HAND = '"Gaegu","Gowun Dodum",sans-serif';
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, u) => a + (b - a) * u;

export class BallGame {
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
    this.t = 0; this.score = 0; this.combo = 0; this.maxCombo = 0; this.lives = 3;
    this.balls = []; this.nextThrow = 0.9; this.thrown = 0; this.fx = [];
    this.jumpT = -1; this.holdT = 0; this.sadT = 0; this.endT = 0; this.count = 0; this.throwSide = 1; this.throwT = 0;
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }
  // 화면 배치 (크기 바뀌어도 맞게)
  get groundY() { return this.H * 0.8; }
  get dogH() { return Math.min(this.H * 0.3, 150); }
  get jumpH() { return this.dogH * 0.42; }
  // 강아지 입이 점프 꼭대기에 있을 때 위치 = 공 잡는 곳
  get catchP() { return { x: this.W / 2, y: this.groundY - this.dogH * 0.49 - this.jumpH }; }

  start() {
    cancelAnimationFrame(this.raf);
    this.reset(); this.resize();
    this.state = 'count'; this.count = 3;
    this.last = performance.now();
    return new Promise((res) => { this.done = res; this.raf = requestAnimationFrame(this.loop); });
  }
  pause() { if (this.state === 'play' || this.state === 'count') { this.paused = this.state; this.state = 'pause'; cancelAnimationFrame(this.raf); this.draw(); } }
  resume() { if (this.state === 'pause') { this.state = this.paused; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stop() { cancelAnimationFrame(this.raf); this.state = 'idle'; this.done = null; }

  // 콕!
  tap() {
    if (this.state !== 'play') return;
    if (this.jumpT < 0 || this.jumpT > 0.32) this.jumpT = 0;   // 점프 (공 잡는 중이 아니면 다시)
    // 가장 가까운 공 판정
    let best = null, bd = Infinity;
    for (const b of this.balls) if (!b.judged) { const d = Math.abs(this.t - b.arrive); if (d < bd) { bd = d; best = b; } }
    const p = this.catchP;
    if (best && bd <= best.good) {
      best.judged = true; best.caught = true;
      const perfect = bd <= best.perfect;
      this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      const pts = (perfect ? 3 : 1) * Math.min(3, 1 + Math.floor(this.combo / 10));   // 10콤보마다 x2, 20콤보부터 x3
      this.score += pts;
      this.holdT = 0.4;
      this.fxText(perfect ? `Perfect! +${pts}` : `Good +${pts}`, p.x, p.y - 40, perfect ? '#E8696A' : '#1f1f1f');
      if (this.combo > 1 && this.combo % 5 === 0) this.fxText(`${this.combo} 콤보! 🔥`, this.W / 2, this.H * 0.3, '#E8696A', 1.4);
    } else {
      if (this.combo) this.fxText('앗! 콤보 끊김', p.x, p.y - 40, '#888');
      this.combo = 0;
    }
  }
  fxText(text, x, y, color, scale = 1) { this.fx.push({ text, x, y, color, scale, t: 0 }); }

  throwBall() {
    const n = this.thrown++;
    const flight = Math.max(0.6, 1.35 - n * 0.018);
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = Math.random();
    const kind = n < 4 ? 'lob' : r < 0.45 ? 'lob' : r < 0.75 ? 'line' : 'bounce';
    const p = this.catchP;
    const b = {
      n, good: goodOf(n), perfect: perfectOf(n),
      kind, side, flight, t0: this.t, arrive: this.t + flight,
      sx: side < 0 ? -16 : this.W + 16, sy: this.groundY - this.H * rand(0.12, 0.3),
      ex: p.x, ey: p.y,
      h: kind === 'lob' ? this.H * rand(0.25, 0.42) : kind === 'line' ? this.H * rand(0.02, 0.07) : this.H * 0.16,
      gx: lerp(side < 0 ? 0 : this.W, p.x, 0.55), spin: rand(4, 9) * side,
    };
    this.balls.push(b);
    this.throwSide = side; this.throwT = 0.3;
    const gap = Math.max(0.5, 1.55 - n * 0.025);
    this.nextThrow = gap * rand(0.8, 1.3);
    // 30개 넘으면 가끔 연달아 두 개 (0.3초 차이)
    this.dbl = !this.dbl && n > 30 && Math.random() < 0.18;
    if (this.dbl) this.nextThrow = 0.3;
  }
  ballPos(b, t) {
    const u = (t - b.t0) / b.flight;
    if (u <= 1) {
      if (b.kind === 'bounce') {
        if (u < 0.55) { const v = u / 0.55; return { x: lerp(b.sx, b.gx, v), y: lerp(b.sy, this.groundY - 8, v) - b.h * 4 * v * (1 - v) }; }
        const v = (u - 0.55) / 0.45; return { x: lerp(b.gx, b.ex, v), y: lerp(this.groundY - 8, b.ey, v) - b.h * 1.4 * 4 * v * (1 - v) };
      }
      return { x: lerp(b.sx, b.ex, u), y: lerp(b.sy, b.ey, u) - b.h * 4 * u * (1 - u) };
    }
    // 놓친 공: 계속 날아가면서 떨어져
    const dt = t - b.arrive, vx = (b.ex - b.sx) / b.flight;
    return { x: b.ex + vx * dt, y: b.ey + 200 * dt + 700 * dt * dt };
  }

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
    if (this.jumpT >= 0) { this.jumpT += dt; if (this.jumpT > 0.55) this.jumpT = -1; }
    if (this.holdT > 0) this.holdT -= dt;
    if (this.sadT > 0) this.sadT -= dt;
    if (this.throwT > 0) this.throwT -= dt;
    if (this.state === 'count') { this.count -= dt; if (this.count <= 0) this.state = 'play'; return; }
    if (this.state === 'end') { this.endT += dt; if (this.endT > 0.9) this.state = 'over'; return; }
    if (this.state !== 'play') return;
    this.t += dt;
    this.nextThrow -= dt;
    if (this.nextThrow <= 0) this.throwBall();
    for (const b of this.balls) {
      if (!b.judged && this.t > b.arrive + b.good) {   // 놓침
        b.judged = true; b.missed = true;
        this.lives--; this.combo = 0; this.sadT = 0.7;
        this.fxText('Miss 💦', this.catchP.x, this.catchP.y - 40, '#4A90C8');
      }
    }
    // 잡은 공은 잠깐 물고 있다가 사라지고, 놓친 공은 화면 밖으로
    this.balls = this.balls.filter((b) => (b.caught ? this.t - b.arrive < 0.45 : this.ballPos(b, this.t).y < this.H + 40));
    if (this.lives <= 0) { this.state = 'end'; this.endT = 0; }
  }

  dogOffset() {   // 점프 높이: 빨리 올라가고(0.1초), 잠깐 머물고, 내려와
    const t = this.jumpT;
    if (t < 0) return { y: 0, sq: 1 };
    if (t < 0.1) return { y: this.jumpH * (t / 0.1), sq: 1.06 };
    if (t < 0.3) return { y: this.jumpH, sq: 1 };
    if (t < 0.5) { const v = (t - 0.3) / 0.2; return { y: this.jumpH * (1 - v * v), sq: 1 }; }
    return { y: 0, sq: 0.92 };   // 착지 찌그러짐
  }

  draw() {
    const { x, W, H } = this;
    if (!W) return;
    const gy = this.groundY;
    // 하늘 + 잔디
    const sky = x.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#EAF3FC'); sky.addColorStop(1, '#FFFFFF');
    x.fillStyle = sky; x.fillRect(0, 0, W, gy);
    x.fillStyle = '#CFE8C6';
    [[0.12, 60], [0.88, 70], [0.5, 40]].forEach(([fx, r]) => { x.beginPath(); x.ellipse(W * fx, gy, r * 1.6, r * 0.8, 0, Math.PI, 0); x.fill(); });
    x.fillStyle = '#DDF0D9'; x.fillRect(0, gy, W, H - gy);
    x.strokeStyle = '#1f1f1f'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke();
    x.strokeStyle = '#9ACB8F'; x.lineWidth = 2; x.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const gx = (i + 0.5) * W / 9, yy = gy + 16 + (i % 3) * 14; x.beginPath(); x.moveTo(gx - 5, yy); x.lineTo(gx - 2, yy - 7); x.moveTo(gx + 1, yy); x.lineTo(gx + 4, yy - 8); x.stroke(); }

    // 던지는 사람 (상대방)
    if (this.opts.thrower) {
      x.font = `${Math.round(H * 0.075)}px sans-serif`; x.textAlign = 'center';
      const jump = this.throwT > 0 ? Math.sin((0.3 - this.throwT) / 0.3 * Math.PI) * 8 : 0;
      x.fillText(this.opts.thrower, this.throwSide < 0 ? 26 : W - 26, gy - 6 - jump);
    }

    // 잡는 곳 (점선 동그라미) + 다가오는 공의 줄어드는 동그라미
    const p = this.catchP, R = Math.max(20, this.dogH * 0.16);
    x.setLineDash([5, 6]); x.strokeStyle = 'rgba(31,31,31,.35)'; x.lineWidth = 2.5;
    x.beginPath(); x.arc(p.x, p.y, R, 0, 7); x.stroke(); x.setLineDash([]);
    let next = null;
    for (const b of this.balls) if (!b.judged && (!next || b.arrive < next.arrive)) next = b;
    if (next && this.state === 'play') {
      const left = Math.max(0, (next.arrive - this.t) / next.flight);
      const close = Math.abs(this.t - next.arrive) <= next.good;
      x.strokeStyle = close ? '#E8696A' : '#FFB347'; x.lineWidth = close ? 4.5 : 3;
      x.beginPath(); x.arc(p.x, p.y, R * (1 + 2.2 * left), 0, 7); x.stroke();
    }

    // 강아지
    const off = this.dogOffset(), dh = this.dogH, dw = dh * 200 / 214;
    const img = (this.sadT > 0 || this.state === 'end' ? this.imgs.scared : this.imgs.happy) || this.imgs.happy;
    x.fillStyle = 'rgba(0,0,0,.08)';
    x.beginPath(); x.ellipse(W / 2, gy + 2, dw * 0.42 * (1 - off.y / (this.jumpH * 3)), 6, 0, 0, 7); x.fill();
    x.save();
    x.translate(W / 2, gy - off.y);
    x.scale(2 - off.sq, off.sq);
    if (img) x.drawImage(img, -dw / 2, -dh, dw, dh);
    x.restore();

    // 공
    for (const b of this.balls) {
      let q = this.ballPos(b, Math.min(this.t, b.caught ? b.arrive : this.t));
      if (b.caught) q = { x: W / 2, y: gy - off.y - dh * 0.49 };   // 입에 물고 있기
      this.drawBall(q.x, q.y, Math.max(10, dh * 0.085), b.caught ? 0 : (this.t - b.t0) * b.spin);
    }

    // 점수 / 콤보 / 목숨
    x.textAlign = 'left'; x.fillStyle = '#1f1f1f';
    x.font = `700 ${Math.round(Math.max(24, W * 0.075))}px ${HAND}`;
    x.fillText(`${this.score}점`, 14, 38);
    if (this.combo >= 2) { x.font = `700 18px ${HAND}`; x.fillStyle = '#E8696A'; x.fillText(`${this.combo} 콤보`, 16, 62); }
    x.textAlign = 'right'; x.font = `${Math.round(Math.max(20, W * 0.06))}px sans-serif`;
    x.fillText('❤️'.repeat(Math.max(0, this.lives)) + '🤍'.repeat(Math.max(0, 3 - this.lives)), W - 12, 38);

    // 판정 글자
    x.textAlign = 'center';
    this.fx.forEach((f) => {
      x.globalAlpha = Math.max(0, 1 - f.t / 0.9);
      x.fillStyle = f.color; x.font = `700 ${Math.round(22 * f.scale)}px ${HAND}`;
      x.fillText(f.text, f.x, f.y - f.t * 40);
    });
    x.globalAlpha = 1;

    if (this.state === 'count') {
      x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(W * 0.28)}px ${HAND}`; x.textAlign = 'center';
      x.fillText(String(Math.ceil(this.count)), W / 2, H * 0.45);
    }
    if (this.state === 'pause') { x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(0, 0, W, H); }
  }

  drawBall(bx, by, r, rot) {
    const x = this.x;
    x.save(); x.translate(bx, by); x.rotate(rot);
    x.fillStyle = '#fff'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 2.5;
    x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill(); x.stroke();
    x.strokeStyle = '#E8696A'; x.lineWidth = 1.8;
    x.beginPath(); x.arc(-r * 1.25, 0, r * 0.9, -0.75, 0.75); x.stroke();
    x.beginPath(); x.arc(r * 1.25, 0, r * 0.9, Math.PI - 0.75, Math.PI + 0.75); x.stroke();
    x.restore();
  }
}
