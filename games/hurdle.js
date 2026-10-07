// 🏃 허들 넘기 — 강아지가 계속 달려! 허들은 ⬆ 점프로 넘고, 날아오는 새는 ⬇ 숙여서 피하기 (구글 공룡 게임 느낌)
//   점프 버튼을 짧게 누르면 낮게, 길게 누르면 높게. 공중에서 ⬇ 누르면 빨리 내려와.
//   한 번 부딪히면 끝. 갈수록 빨라지고, 새·두 개 연속 허들·높은 새(점프하면 부딪힘)가 섞여.
// 쓰는 법: const g = new HurdleGame(canvas, { happy, scared });  const meters = await g.start();  g.jump() / g.release() / g.duck(true|false)

const PX_PER_M = 40;          // 40px = 1m
const GRAV = 2200;            // px/s²
const JUMP_V = 820;           // 점프 시작 속도
const CUT_V = 520;            // 버튼을 일찍 떼면 이 속도까지 줄여서 조금 낮은 점프
const HAND = '"Gaegu","Gowun Dodum",sans-serif';
const rand = (a, b) => a + Math.random() * (b - a);

export class HurdleGame {
  constructor(canvas, imgs) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.imgs = imgs || {};
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
    this.t = 0; this.dist = 0; this.scroll = 0; this.speed = 260;
    this.y = 0; this.vy = 0; this.onGround = true; this.holding = false; this.ducking = false;
    this.obs = []; this.nextGap = 260; this.cleared = 0; this.dust = []; this.endT = 0; this.count = 0; this.hit = null;
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }
  get groundY() { return this.H * 0.74; }
  get dogH() { return Math.min(this.H * 0.17, 92); }   // 작게 (멀리 오는 장애물이 보이게)
  get dogX() { return this.W * 0.22; }

  start() {
    cancelAnimationFrame(this.raf);
    this.reset(); this.resize();
    this.state = 'count'; this.count = 3;
    this.last = performance.now();
    return new Promise((res) => { this.done = res; this.raf = requestAnimationFrame(this.loop); });
  }
  pause() { if (this.state === 'play' || this.state === 'count') { this.paused = this.state; this.state = 'pause'; this.holding = false; this.ducking = false; cancelAnimationFrame(this.raf); this.draw(); } }
  resume() { if (this.state === 'pause') { this.state = this.paused; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stop() { cancelAnimationFrame(this.raf); this.state = 'idle'; this.done = null; }

  // ⬆ 점프 (누르는 동안 holding) / 떼기 / ⬇ 숙이기
  jump() {
    if (this.state !== 'play') return;
    this.holding = true;
    if (this.onGround && !this.ducking) { this.vy = JUMP_V; this.onGround = false; }
  }
  release() { this.holding = false; if (!this.onGround && this.vy > CUT_V) this.vy = CUT_V; }
  duck(on) {
    if (this.state !== 'play' && on) return;
    this.ducking = on;
    if (on && !this.onGround) this.vy = Math.min(this.vy, -700);   // 공중이면 빨리 내려오기
  }

  spawn() {
    const m = this.dist, r = Math.random(), dh = this.dogH, gx = this.W + 30;
    let kind = 'hurdle';
    if (this.cleared >= 4) {
      if (m > 90 && r < 0.26) kind = 'bird';
      else if (m > 180 && r < 0.4) kind = 'double';
      else if (m > 260 && r < 0.5) kind = 'high';   // 높은 새: 점프하면 부딪혀, 그냥 달리면 지나감
    }
    if (kind === 'hurdle') this.obs.push({ kind, x: gx, w: 16, h: dh * rand(0.42, 0.62) });
    if (kind === 'double') { const h = dh * 0.45; this.obs.push({ kind: 'hurdle', x: gx, w: 16, h }, { kind: 'hurdle', x: gx + Math.max(46, this.speed * 0.17), w: 16, h, tail: true }); }
    if (kind === 'bird') this.obs.push({ kind, x: gx, w: 40, bottom: dh * 0.66, h: 26, flap: rand(0, 6) });
    if (kind === 'high') this.obs.push({ kind: 'bird', x: gx, w: 40, bottom: dh * 1.08, h: 26, flap: rand(0, 6), high: true });
    // 다음 장애물까지 거리: 점프하고 내려올 시간 + 여유. 빨라질수록 간격도 넓어지지만 시간상으론 촘촘해져
    const air = 2 * JUMP_V / GRAV;
    const margin = Math.max(0.1, 0.32 - this.t * 0.003);              // 시간이 갈수록 촘촘하게
    const minGap = this.speed * (air + margin) + (kind === 'double' ? 70 : 0);
    this.nextGap = minGap + this.speed * rand(0.1, Math.max(0.45, 1.1 - this.t * 0.008));
  }

  loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.state === 'over') { const d = this.done; this.done = null; if (d) d(this.dist); return; }
    if (this.state === 'count' || this.state === 'play' || this.state === 'end') this.raf = requestAnimationFrame(this.loop);
  }

  dogBox() {   // 부딪힘 판정 상자 (그림보다 살짝 작게 = 억울함 방지)
    const dh = this.dogH, h = dh * (this.ducking && this.onGround ? 0.5 : 0.88), w = dh * 0.46;
    return { l: this.dogX - w / 2, r: this.dogX + w / 2, b: this.y + dh * 0.04, t: this.y + h };   // 땅에서 위로 잰 높이
  }
  update(dt) {
    this.dust.forEach((p) => { p.t += dt; p.x -= this.speed * dt * 0.6; }); this.dust = this.dust.filter((p) => p.t < 0.5);
    if (this.state === 'count') { this.count -= dt; this.scroll += 120 * dt; if (this.count <= 0) this.state = 'play'; return; }
    if (this.state === 'end') {
      this.endT += dt;
      if (!this.onGround) { this.vy -= GRAV * dt; this.y = Math.max(0, this.y + this.vy * dt); if (this.y === 0) this.onGround = true; }
      if (this.endT > 1) this.state = 'over';
      return;
    }
    if (this.state !== 'play') return;
    this.t += dt;
    this.speed = Math.min(700, 260 + this.t * 7.5);   // px/s (약 1분이면 최고 속도)
    const dx = this.speed * dt;
    this.dist += dx / PX_PER_M; this.scroll += dx;
    // 점프 물리
    if (!this.onGround) {
      this.vy -= GRAV * dt * (this.holding && this.vy > 0 ? 0.62 : 1);   // 누르고 있으면 조금 더 높이
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0; this.onGround = true;
        for (let i = 0; i < 5; i++) this.dust.push({ x: this.dogX + rand(-14, 14), y: 0, t: rand(0, 0.15), r: rand(3, 6) });
      }
    }
    // 장애물
    this.nextGap -= dx;
    if (this.nextGap <= 0) this.spawn();
    const box = this.dogBox();
    for (const o of this.obs) {
      o.x -= dx;
      if (o.kind === 'bird') o.x -= dx * 0.25;   // 새는 조금 더 빨리 날아와
      const ob = o.kind === 'hurdle' ? { l: o.x, r: o.x + o.w, b: 0, t: o.h } : { l: o.x + 4, r: o.x + o.w - 4, b: o.bottom, t: o.bottom + o.h };
      if (box.r > ob.l && box.l < ob.r && box.t > ob.b && box.b < ob.t) {
        this.hit = o; this.state = 'end'; this.endT = 0; this.ducking = false;
        if (navigator.vibrate) { try { navigator.vibrate(80); } catch {} }
        return;
      }
      if (!o.passed && o.x + o.w < box.l) { o.passed = true; if (!o.tail) this.cleared++; }
    }
    this.obs = this.obs.filter((o) => o.x + o.w > -60);
  }

  draw() {
    const { x, W, H } = this;
    if (!W) return;
    const gy = this.groundY;
    // 하늘
    const sky = x.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#EAF3FC'); sky.addColorStop(1, '#FFFFFF');
    x.fillStyle = sky; x.fillRect(0, 0, W, gy);
    // 구름 · 언덕 (느리게)
    x.fillStyle = '#fff'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 180 + 60 - this.scroll * 0.1) % (W + 160) + W + 160) % (W + 160) - 80, cy = H * (0.12 + i * 0.08);
      x.beginPath(); x.arc(cx, cy, 12, Math.PI, 0); x.arc(cx + 18, cy - 5, 14, Math.PI, 0); x.arc(cx + 38, cy, 11, Math.PI, 0); x.closePath(); x.fill(); x.stroke();
    }
    x.fillStyle = '#CFE8C6';
    for (let i = 0; i < 5; i++) {
      const hx = ((i * 140 - this.scroll * 0.3) % (W + 280) + W + 280) % (W + 280) - 140;
      x.beginPath(); x.ellipse(hx, gy, 90, 34 + (i % 2) * 16, 0, Math.PI, 0); x.fill();
    }
    // 달리기 트랙
    x.fillStyle = '#F2C9A0'; x.fillRect(0, gy, W, H - gy);
    x.strokeStyle = '#fff'; x.lineWidth = 3;
    [0.35, 0.75].forEach((f) => { const ly = gy + (H - gy) * f; x.beginPath(); x.moveTo(0, ly); x.lineTo(W, ly); x.stroke(); });
    x.strokeStyle = 'rgba(31,31,31,.25)'; x.lineWidth = 2;
    const off = ((-this.scroll) % 60 + 60) % 60;
    for (let lx = off - 60; lx < W; lx += 60) { x.beginPath(); x.moveTo(lx, gy + 8); x.lineTo(lx + 10, gy + 8); x.stroke(); }
    x.strokeStyle = '#1f1f1f'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke();

    // 장애물
    for (const o of this.obs) {
      if (o.kind === 'hurdle') this.drawHurdle(o.x, gy, o.w, o.h);
      else this.drawBird(o.x, gy - o.bottom - o.h, o.w, o.h, o.flap + this.t * 14, o.high);
    }

    // 먼지
    x.fillStyle = 'rgba(180,140,100,.5)';
    this.dust.forEach((p) => { x.globalAlpha = 1 - p.t / 0.5; x.beginPath(); x.arc(p.x, gy - 3 - p.t * 14, p.r * (1 + p.t), 0, 7); x.fill(); });
    x.globalAlpha = 1;

    // 강아지
    const dh = this.dogH, dw = dh * 200 / 214;
    const running = this.state === 'play' && this.onGround;
    const duck = this.ducking && this.onGround && this.state === 'play';
    const bob = running && !duck ? Math.abs(Math.sin(this.t * 16)) * dh * 0.07 : 0;
    const tilt = this.state === 'end' ? -0.5 * Math.min(1, this.endT * 3) : !this.onGround ? -Math.max(-0.25, Math.min(0.25, this.vy / 3000)) : running ? Math.sin(this.t * 16) * 0.05 : 0;
    const img = (this.state === 'end' ? this.imgs.scared : this.imgs.happy) || this.imgs.happy;
    x.fillStyle = 'rgba(0,0,0,.1)';
    x.beginPath(); x.ellipse(this.dogX, gy + 2, dw * 0.38 * Math.max(0.45, 1 - this.y / 300), 5, 0, 0, 7); x.fill();
    x.save();
    x.translate(this.dogX, gy - this.y - bob);
    x.rotate(tilt);
    x.scale(duck ? 1.18 : 1, duck ? 0.56 : 1);   // 쭈그리기 = 납작하게
    if (img) x.drawImage(img, -dw / 2, -dh, dw, dh);
    else { x.fillStyle = '#E6B886'; x.beginPath(); x.arc(0, -dh / 2, dh / 2.4, 0, 7); x.fill(); }
    x.restore();
    if (this.state === 'end' && this.hit) {
      x.font = `700 ${Math.round(dh * 0.4)}px ${HAND}`; x.textAlign = 'center'; x.fillStyle = '#E8696A';
      x.fillText('꽈당!', this.dogX + dw * 0.3, gy - this.y - dh * 1.15);
    }

    // 점수
    x.textAlign = 'left'; x.fillStyle = '#1f1f1f';
    x.font = `700 ${Math.round(Math.max(24, W * 0.075))}px ${HAND}`;
    x.fillText(`${Math.floor(this.dist)}m`, 14, 38);
    x.font = `700 16px ${HAND}`; x.fillStyle = '#666';
    x.fillText(`허들 ${this.cleared}개`, 16, 60);

    if (this.state === 'count') {
      x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(W * 0.28)}px ${HAND}`; x.textAlign = 'center';
      x.fillText(String(Math.ceil(this.count)), W / 2, H * 0.45);
      x.font = `700 18px ${HAND}`; x.fillText('⬆ 허들은 점프 · ⬇ 새는 숙이기', W / 2, H * 0.56);
    }
    if (this.state === 'pause') { x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(0, 0, W, H); }
  }

  drawHurdle(hx, gy, w, h) {
    const x = this.x;
    x.lineCap = 'round'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(hx + 2, gy); x.lineTo(hx + 2, gy - h); x.moveTo(hx + w - 2, gy); x.lineTo(hx + w - 2, gy - h); x.stroke();   // 기둥
    x.beginPath(); x.moveTo(hx - 4, gy); x.lineTo(hx + 8, gy); x.moveTo(hx + w - 8, gy); x.lineTo(hx + w + 4, gy); x.stroke();          // 받침
    const bh = Math.max(8, h * 0.2);   // 빨강·하양 줄무늬 가로대
    x.fillStyle = '#fff'; x.fillRect(hx - 3, gy - h, w + 6, bh);
    x.save(); x.beginPath(); x.rect(hx - 3, gy - h, w + 6, bh); x.clip();
    x.fillStyle = '#E8696A';
    for (let i = -1; i < 4; i++) x.fillRect(hx - 3 + i * 9, gy - h, 5, bh);
    x.restore();
    x.lineWidth = 2.5; x.strokeRect(hx - 3, gy - h, w + 6, bh);
  }
  drawBird(bx, top, w, h, flap, high) {
    const x = this.x, cy = top + h / 2, up = Math.sin(flap) > 0;
    x.fillStyle = high ? '#B9A7DA' : '#9CCBF0'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 2.5; x.lineJoin = 'round';
    x.beginPath(); x.ellipse(bx + w * 0.55, cy, w * 0.36, h * 0.36, 0, 0, 7); x.fill(); x.stroke();          // 몸
    x.beginPath(); x.arc(bx + w * 0.22, cy - 2, h * 0.26, 0, 7); x.fill(); x.stroke();                         // 머리
    x.fillStyle = '#FFD84D';
    x.beginPath(); x.moveTo(bx + w * 0.06, cy - 3); x.lineTo(bx - 6, cy); x.lineTo(bx + w * 0.06, cy + 3); x.closePath(); x.fill(); x.stroke();   // 부리 (왼쪽 = 날아오는 방향)
    x.fillStyle = '#1f1f1f'; x.beginPath(); x.arc(bx + w * 0.18, cy - 4, 2, 0, 7); x.fill();                  // 눈
    x.fillStyle = high ? '#B9A7DA' : '#9CCBF0';
    x.beginPath(); x.moveTo(bx + w * 0.45, cy - 2);                                                             // 날개 (팔락팔락)
    x.quadraticCurveTo(bx + w * 0.62, up ? cy - h * 1.1 : cy + h * 0.9, bx + w * 0.8, cy - 1);
    x.closePath(); x.fill(); x.stroke();
  }
}
