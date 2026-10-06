// 🪵 통나무 타기 — 강아지가 통나무를 타고 강을 내려가. 앞뒤로 기우는 걸 터치로 바로잡기!
//   앞으로 기울면 '◀ 뒤로', 뒤로 기울면 '앞으로 ▶'. 오래(멀리) 버틸수록 점수(m).
//   물리는 '거꾸로 세운 진자' 같은 느낌: 기울수록 더 빨리 넘어가고, 바람이 불고, 시간이 지날수록 어려워져.
// 쓰는 법: const g = new LogGame(canvas, { happy: img, scared: img });  const meters = await g.start();  g.push(+1 | -1)

const FALL = 1.05;          // 이만큼(라디안, 약 60°) 기울면 풍덩
const PUSH = 1.15;          // 터치 한 번에 바뀌는 각속도
const HAND = '"Gaegu","Gowun Dodum",sans-serif';
const rand = (a, b) => a + Math.random() * (b - a);

export class LogGame {
  constructor(canvas, imgs) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.imgs = imgs || {};
    this.state = 'idle';   // idle → count → play → fall → over (pause 가능)
    this.raf = 0;
    this.reset();
    this.loop = this.loop.bind(this);
    this.onResize = () => { this.resize(); if (this.state !== 'play') this.draw(); };
    addEventListener('resize', this.onResize);
    this.resize();
  }
  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.onResize); this.state = 'idle'; }

  reset() {
    this.t = 0; this.th = 0; this.w = 0; this.dist = 0; this.scroll = 0;
    this.gust = 0; this.nextGust = 2.5; this.ph = [rand(0, 7), rand(0, 7)];
    this.fallT = 0; this.drop = 0; this.splash = []; this.pushDir = 0; this.pushT = 0; this.count = 0;
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.x.setTransform(d, 0, 0, d, 0, 0);
  }

  // 3·2·1 하고 시작. 넘어지면 간 거리(m)로 resolve
  start() {
    cancelAnimationFrame(this.raf);
    this.reset();
    this.resize();
    this.th = (Math.random() < 0.5 ? -1 : 1) * 0.04;
    this.state = 'count'; this.count = 3;
    this.last = performance.now();
    return new Promise((res) => { this.done = res; this.raf = requestAnimationFrame(this.loop); });
  }
  push(dir) {
    if (this.state !== 'play') return;
    this.w += dir * PUSH;
    this.pushDir = dir; this.pushT = 0.22;
  }
  pause() { if (this.state === 'play' || this.state === 'count') { this.paused = this.state; this.state = 'pause'; cancelAnimationFrame(this.raf); this.draw(); } }
  resume() { if (this.state === 'pause') { this.state = this.paused; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stop() { cancelAnimationFrame(this.raf); this.state = 'idle'; this.done = null; }

  loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.state === 'over') { const d = this.done; this.done = null; if (d) d(this.dist); return; }
    if (this.state === 'count' || this.state === 'play' || this.state === 'fall') this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    if (this.pushT > 0) this.pushT -= dt;
    if (this.state === 'count') {
      this.count -= dt;
      this.scroll += 60 * dt;
      if (this.count <= 0) this.state = 'play';
      return;
    }
    if (this.state === 'play') {
      const t = (this.t += dt);
      const G = Math.min(5, 2.2 + 0.035 * t);          // 넘어가려는 힘 (점점 세져)
      const A = Math.min(1.7, 0.35 + 0.025 * t);       // 살랑바람
      const wind = A * (0.6 * Math.sin(1.3 * t + this.ph[0]) + 0.4 * Math.sin(2.7 * t + this.ph[1]));
      this.nextGust -= dt;
      if (this.nextGust <= 0) {                         // 가끔 휙! 돌풍
        this.gust = (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 1.6) * (1 + t / 60);
        this.nextGust = rand(1.6, 4) - Math.min(1, t / 90);
      }
      this.gust *= Math.exp(-3 * dt);
      const acc = G * Math.sin(this.th) + wind + this.gust - 0.7 * this.w;
      this.w += acc * dt;
      this.th += this.w * dt;
      const v = Math.min(6.5, 2.2 + 0.045 * t);        // m/s, 점점 빨라져
      this.dist += v * dt;
      this.scroll += v * 40 * dt;
      if (Math.abs(this.th) > FALL) {
        this.state = 'fall'; this.fallT = 0;
        for (let i = 0; i < 16; i++) this.splash.push({ x: 0, y: 0, vx: rand(-90, 90), vy: rand(-260, -120), r: rand(3, 7) });
      }
      return;
    }
    if (this.state === 'fall') {
      this.fallT += dt;
      this.th += Math.sign(this.th) * 2.2 * dt;
      this.drop += 260 * dt * this.fallT * 2.5;
      this.splash.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; });
      if (this.fallT > 1) this.state = 'over';
    }
  }

  draw() {
    const { x, W, H } = this;
    if (!W) return;
    const waterY = H * 0.68;
    // 하늘
    const sky = x.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, '#EAF3FC'); sky.addColorStop(1, '#FFFFFF');
    x.fillStyle = sky; x.fillRect(0, 0, W, waterY);
    // 구름 (천천히)
    x.fillStyle = '#fff'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 190 + 40 - this.scroll * 0.08) % (W + 160) + W + 160) % (W + 160) - 80, cy = H * (0.16 + i * 0.07);
      x.beginPath(); x.arc(cx, cy, 14, Math.PI, 0); x.arc(cx + 20, cy - 6, 16, Math.PI, 0); x.arc(cx + 42, cy, 13, Math.PI, 0); x.closePath();
      x.fill(); x.stroke();
    }
    // 언덕 (멀리, 느리게)
    x.fillStyle = '#CFE8C6';
    for (let i = 0; i < 5; i++) {
      const hx = ((i * 150 - this.scroll * 0.25) % (W + 300) + W + 300) % (W + 300) - 150;
      x.beginPath(); x.ellipse(hx, waterY, 110, 46 + (i % 2) * 18, 0, Math.PI, 0); x.fill();
    }
    // 강
    x.fillStyle = '#9CCBF0'; x.fillRect(0, waterY, W, H - waterY);
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2.5; x.lineCap = 'round';
    for (let row = 0; row < 4; row++) {
      const y = waterY + 18 + row * ((H - waterY - 18) / 4), sp = 1 + row * 0.35;
      for (let i = -1; i < W / 70 + 1; i++) {
        const wx = ((i * 70 + row * 31 - this.scroll * sp) % (W + 70) + W + 70) % (W + 70) - 35;
        x.beginPath(); x.arc(wx, y, 9, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
      }
    }
    x.strokeStyle = '#1f1f1f'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, waterY); x.lineTo(W, waterY); x.stroke();

    // 통나무 (옆에서 본 모습, 구르는 결)
    const lx = W * 0.1, lw = W * 0.72, lh = Math.max(22, H * 0.06), ly = waterY - lh * 0.55;
    const bob = Math.sin(this.scroll * 0.03) * 1.5;
    x.save(); x.translate(0, bob);
    x.fillStyle = '#B98455'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 3;
    x.beginPath(); x.roundRect(lx, ly, lw, lh, lh / 2); x.fill(); x.stroke();
    x.save(); x.beginPath(); x.roundRect(lx, ly, lw, lh, lh / 2); x.clip();
    x.strokeStyle = '#8A5A33'; x.lineWidth = 2;
    const off = ((-this.scroll * 0.9) % 26 + 26) % 26;   // 결이 앞→뒤로 흘러서 구르는 느낌
    for (let i = -1; i < lw / 26 + 2; i++) {
      const bx = lx + i * 26 + off;
      x.beginPath(); x.moveTo(bx, ly + 4); x.quadraticCurveTo(bx + 5, ly + lh / 2, bx, ly + lh - 4); x.stroke();
    }
    x.restore();
    x.fillStyle = '#E3B98A'; x.lineWidth = 3; x.strokeStyle = '#1f1f1f';   // 나이테 단면
    x.beginPath(); x.ellipse(lx + lw - lh * 0.35, ly + lh / 2, lh * 0.32, lh / 2 - 1.5, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    x.lineWidth = 1.5; x.beginPath(); x.ellipse(lx + lw - lh * 0.35, ly + lh / 2, lh * 0.15, lh * 0.25, 0, 0, Math.PI * 2); x.stroke();
    x.restore();

    // 강아지
    const fx = W * 0.42, fy = ly + bob + 3;
    const scared = this.state === 'fall' || Math.abs(this.th) > 0.55;
    const img = (scared ? this.imgs.scared : this.imgs.happy) || this.imgs.happy;
    const dh = Math.min(H * 0.36, 170), dw = dh * 200 / 214;
    x.save();
    x.translate(fx, fy + this.drop);
    x.rotate(this.th);
    if (img) x.drawImage(img, -dw / 2, -dh * 0.97, dw, dh);
    else { x.fillStyle = '#E6B886'; x.beginPath(); x.arc(0, -dh / 2, dh / 3, 0, 7); x.fill(); }
    x.restore();
    if (this.pushT > 0) {   // 터치한 쪽에서 💨
      x.font = `${Math.round(dh * 0.2)}px sans-serif`; x.textAlign = 'center';
      x.globalAlpha = Math.min(1, this.pushT * 6);
      x.fillText('💨', fx - this.pushDir * dw * 0.62, fy - dh * 0.55);
      x.globalAlpha = 1;
    }
    // 풍덩
    if (this.splash.length) {
      x.fillStyle = '#9CCBF0'; x.strokeStyle = '#1f1f1f'; x.lineWidth = 2;
      const sx = fx + Math.sign(this.th) * dw * 0.6;
      this.splash.forEach((p) => { x.beginPath(); x.arc(sx + p.x, waterY + p.y, p.r, 0, 7); x.fill(); x.stroke(); });
    }

    // 점수
    x.textAlign = 'left'; x.fillStyle = '#1f1f1f';
    x.font = `700 ${Math.round(Math.max(24, W * 0.075))}px ${HAND}`;
    x.fillText(`${this.dist.toFixed(1)}m`, 14, 38);
    // 기울기 계기판 (빨간 쪽에 가까우면 위험!)
    const mx = W - 62, my = 52, mr = 40;
    x.lineWidth = 9; x.lineCap = 'butt';
    const seg = (a, b, col) => { x.strokeStyle = col; x.beginPath(); x.arc(mx, my, mr, -Math.PI / 2 + a, -Math.PI / 2 + b); x.stroke(); };
    seg(-FALL, -0.7, '#FF8E8F'); seg(-0.7, 0.7, '#DDF0D9'); seg(0.7, FALL, '#FF8E8F');
    x.lineWidth = 2; x.strokeStyle = '#1f1f1f';
    x.beginPath(); x.arc(mx, my, mr + 5.5, -Math.PI / 2 - FALL, -Math.PI / 2 + FALL); x.stroke();
    const a = Math.max(-FALL, Math.min(FALL, this.th));
    x.lineWidth = 3.5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(mx, my); x.lineTo(mx + Math.sin(a) * (mr + 2), my - Math.cos(a) * (mr + 2)); x.stroke();
    x.fillStyle = '#1f1f1f'; x.beginPath(); x.arc(mx, my, 4, 0, 7); x.fill();
    x.font = `700 14px ${HAND}`; x.textAlign = 'center';
    x.fillText('뒤', mx - mr - 10, my + 14); x.fillText('앞', mx + mr + 10, my + 14);

    // 3·2·1
    if (this.state === 'count') {
      x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f1f1f'; x.font = `700 ${Math.round(W * 0.28)}px ${HAND}`; x.textAlign = 'center';
      x.fillText(String(Math.ceil(this.count)), W / 2, H * 0.48);
    }
    if (this.state === 'pause') {
      x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(0, 0, W, H);
    }
  }
}
