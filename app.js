import * as CFG from './config.js';

// config.js 에 값이 없어도 동작하도록 기본값 사용
const FIREBASE_CONFIG = CFG.FIREBASE_CONFIG || {};
const SITE_PIN = CFG.SITE_PIN || '1004';
const START_DATE = CFG.START_DATE || '2025-09-17';   // 이 날이 1일

const FIREBASE_VERSION = '10.12.2';
const CHECK_TEXT = 'gomdol-tokki-ok';
const REMEMBER_KEY = 'couple-key-v1';
const ME_KEY = 'couple-me';

const $ = (id) => document.getElementById(id);
const te = new TextEncoder();
const td = new TextDecoder();

/* ====================== crypto (encrypt_photos.py 와 같은 방식) ====================== */
const b64 = {
  to(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
  from(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }
};
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 512));
  const raw = bits.slice(0, 32);
  const docId = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bits.slice(32))));
  return { raw, docId };
}
const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function decryptBytes(key, blob) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12)));
}
async function encryptBytes(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}

/* ====================== 잠금 화면 ====================== */
// 1단계: 4자리 PIN (화면 잠금, 매번)
// 2단계: 문장 비밀번호 (암호화 열쇠, 기기마다 처음 한 번)
const state = { key: null, docId: null, meta: null };

async function loadMeta() {
  const r = await fetch('gallery/meta.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('no-meta');
  return r.json();
}

async function verify(raw) {
  const key = await importKey(raw);
  const out = await decryptBytes(key, b64.from(state.meta.check)); // 틀리면 여기서 throw
  if (td.decode(out) !== CHECK_TEXT) throw new Error('bad');
  return key;
}

function readSaved() {
  for (const s of [localStorage, sessionStorage]) {
    try {
      const v = JSON.parse(s.getItem(REMEMBER_KEY) || 'null');
      if (v) return v;
    } catch {}
  }
  return null;
}
function clearSaved() {
  try { localStorage.removeItem(REMEMBER_KEY); } catch {}
  try { sessionStorage.removeItem(REMEMBER_KEY); } catch {}
}

function unlocked(key, docId) {
  state.key = key; state.docId = docId;
  $('lock').classList.add('gone');
  initGallery();
  initBucket();
}

// PIN 통과 후: 기억된 열쇠가 있으면 바로 열고, 없으면 2단계로
let metaReady = null;
async function afterPin() {
  await metaReady;
  if (!state.meta) {
    $('pinMsg').textContent = '아직 사진 비밀번호가 없어. encrypt_photos.py를 먼저 실행해 줘.';
    return;
  }
  const saved = readSaved();
  if (saved && saved.salt === state.meta.salt) {
    try { unlocked(await verify(b64.from(saved.raw)), saved.docId); return; }
    catch { clearSaved(); }
  }
  $('pinStep').hidden = true;
  $('lockForm').hidden = false;
  $('pw').focus();
}

/* --- 1단계: 키패드 --- */
(() => {
  const dotsEl = $('dots'), dots = [...dotsEl.children], msg = $('pinMsg'), pad = $('pad');
  let input = '';
  ['1','2','3','4','5','6','7','8','9','지우기','0','♥'].forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = k;
    b.className = 'key' + ((k === '지우기' || k === '♥') ? ' ghost' : '');
    if (k === '♥') { b.setAttribute('aria-hidden', 'true'); b.tabIndex = -1; }
    b.addEventListener('click', () => press(k));
    pad.appendChild(b);
  });
  const render = () => dots.forEach((d, i) => d.classList.toggle('on', i < input.length));
  const active = () => !$('pinStep').hidden && !$('lock').classList.contains('gone');

  function press(k) {
    if (!active() || k === '♥') return;
    if (k === '지우기') { input = input.slice(0, -1); msg.textContent = ''; render(); return; }
    if (input.length >= 4) return;
    input += k; render();
    if (input.length === 4) setTimeout(check, 160);
  }
  function check() {
    if (input === String(SITE_PIN)) {
      msg.textContent = '어서 와!';
      try { sessionStorage.setItem('couple-pin-ok', '1'); } catch {}
      setTimeout(afterPin, 250);
    } else {
      msg.textContent = '틀렸어, 다시 눌러 줘';
      dotsEl.classList.remove('shake'); void dotsEl.offsetWidth; dotsEl.classList.add('shake');
      input = ''; setTimeout(render, 250);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (!active()) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('지우기');
  });
})();

/* --- 2단계: 문장 비밀번호 --- */
$('lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.meta) return;
  const pw = $('pw').value;
  if (!pw) return;
  const btn = $('enter'), msg = $('msg');
  btn.disabled = true; msg.textContent = '여는 중…';
  try {
    const { raw, docId } = await derive(pw, b64.from(state.meta.salt), state.meta.iter);
    const key = await verify(raw);
    const store = $('remember').checked ? localStorage : sessionStorage;
    try { store.setItem(REMEMBER_KEY, JSON.stringify({ salt: state.meta.salt, raw: b64.to(raw), docId })); } catch {}
    msg.textContent = '어서 와!';
    setTimeout(() => unlocked(key, docId), 300);
  } catch {
    msg.textContent = '비밀번호가 달라. 다시 입력해 줘';
    const p = $('pw'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake');
    p.select();
  } finally {
    btn.disabled = false;
  }
});

$('eye').addEventListener('click', () => {
  const p = $('pw'); const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('eye').setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
});

// 잠그기: 다음엔 4자리부터 다시 / 이 기기 잊기: 문장 비밀번호까지 다시
$('relock').addEventListener('click', () => {
  try { sessionStorage.removeItem('couple-pin-ok'); } catch {}
  location.reload();
});
$('forget').addEventListener('click', () => {
  if (!confirm('이 기기에서 열쇠를 지울까? 다음엔 문장 비밀번호를 다시 입력해야 해.')) return;
  clearSaved();
  try { sessionStorage.removeItem('couple-pin-ok'); } catch {}
  location.reload();
});

async function boot() {
  metaReady = loadMeta().then((m) => { state.meta = m; }).catch(() => { state.meta = null; });
  // 같은 탭에서 새로고침하면 4자리는 다시 안 물어봄
  let pinOk = false;
  try { pinOk = sessionStorage.getItem('couple-pin-ok') === '1'; } catch {}
  if (pinOk) afterPin();
}

/* ====================== 만난 지 며칠 ====================== */
function renderDday() {
  const [y, m, d] = START_DATE.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = Math.round((today - start) / 86400000) + 1;   // 시작일 = 1일
  const years = today.getFullYear() - y;
  const el = $('dday');
  if (day < 1) { el.hidden = true; return; }
  let extra = '';
  if (today.getMonth() === m - 1 && today.getDate() === d && years > 0) extra = ` 오늘 ${years}주년이야 🎉`;
  else if (day % 100 === 0) extra = ' 🎉';
  el.innerHTML = '';
  el.append('우리 만난 지 ');
  const b = document.createElement('b'); b.textContent = day.toLocaleString('ko-KR');
  el.append(b, '일!' + extra);
  el.hidden = false;
  // 자정이 지나면 자동으로 하루 올리기
  const next = new Date(today); next.setDate(next.getDate() + 1);
  setTimeout(renderDday, next - now + 1000);
}
renderDday();

/* ====================== 하트 (섹션 3) ====================== */
(() => {
  const t = $('together');
  if (!('IntersectionObserver' in window)) { t.classList.add('seen'); return; }
  new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('seen', e.isIntersecting)),
    { root: $('scroller'), threshold: 0.6 }).observe(t);
})();

/* ====================== 갤러리 (암호화된 사진 읽기 전용) ====================== */
async function fetchDecrypt(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return decryptBytes(state.key, new Uint8Array(await r.arrayBuffer()));
}
const toURL = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));

async function initGallery() {
  const grid = $('grid');
  let photos = [];
  try {
    const r = await fetch('gallery/manifest.enc', { cache: 'no-cache' });
    if (r.ok) photos = JSON.parse(td.decode(await decryptBytes(state.key, new Uint8Array(await r.arrayBuffer()))));
  } catch (e) { console.error(e); }

  grid.innerHTML = '';
  if (!photos.length) {
    const e = document.createElement('div');
    e.className = 'empty'; e.style.gridColumn = '1 / -1';
    e.textContent = '곧 사진이 채워질 거야 📷';
    grid.appendChild(e);
    return;
  }
  $('galSub').textContent = `우리가 같이 찍은 사진 ${photos.length}장`;

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => es.forEach((en) => {
        if (en.isIntersecting) { io.unobserve(en.target); loadThumb(en.target); }
      }), { root: $('scroller'), rootMargin: '300px' })
    : null;

  photos.forEach((p) => {
    const f = document.createElement('figure');
    f.className = 'ph'; f.style.margin = 0; f.tabIndex = 0; f.dataset.id = p.id;
    const im = document.createElement('img'); im.alt = (p.caption || p.date) + ' 사진';
    const cap = document.createElement('span'); cap.textContent = p.caption ? `${p.caption} · ${p.date}` : p.date;
    f.append(im, cap);
    const open = () => openPhoto(p, im.alt);
    f.addEventListener('click', open);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    grid.appendChild(f);
    io ? io.observe(f) : loadThumb(f);
  });
}

async function loadThumb(fig) {
  const im = fig.querySelector('img');
  try {
    im.src = toURL(await fetchDecrypt(`gallery/${fig.dataset.id}_t.enc`));
    im.onload = () => im.classList.add('ready');
  } catch (e) { console.error(e); }
}

const lb = $('lightbox'), lbImg = $('lbImg');
async function openPhoto(p, alt) {
  lbImg.removeAttribute('src'); lbImg.alt = alt;
  lb.classList.add('open');
  try {
    const url = toURL(await fetchDecrypt(`gallery/${p.id}.enc`));
    if (lbImg.dataset.url) URL.revokeObjectURL(lbImg.dataset.url);
    lbImg.dataset.url = url; lbImg.src = url;
  } catch (e) { console.error(e); }
  $('lbClose').focus();
}
$('lbClose').onclick = () => lb.classList.remove('open');
lb.addEventListener('click', (e) => { if (e.target === lb) lb.classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('open'); });

/* ====================== 버킷리스트 (같이 수정, 내용 암호화) ====================== */
const isConfigured = () => !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

async function encryptItems(items) { return b64.to(await encryptBytes(state.key, te.encode(JSON.stringify(items)))); }
async function decryptItems(ct) { return JSON.parse(td.decode(await decryptBytes(state.key, b64.from(ct)))); }

// Firebase 설정 전: 이 기기에만 저장 (테스트용)
function localStore() {
  const K = 'couple-bucket-local';
  let listener = () => {};
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch { return []; } };
  return {
    subscribe(cb) { listener = cb; cb(load()); },
    async mutate(fn) { const next = fn(load()); try { localStorage.setItem(K, JSON.stringify(next)); } catch {} listener(next); }
  };
}

async function firestoreStore(onError) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const app = initializeApp(FIREBASE_CONFIG);
  const db = fs.getFirestore(app);
  const ref = fs.doc(db, 'couples', state.docId);
  return {
    subscribe(cb) {
      fs.onSnapshot(ref, async (snap) => {
        try { cb(snap.exists() ? await decryptItems(snap.data().ct) : []); }
        catch (e) { onError(e); }
      }, onError);
    },
    async mutate(fn) {
      // 둘이 동시에 수정해도 최신 상태 위에 적용되도록 transaction 사용
      await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists() ? await decryptItems(snap.data().ct) : [];
        tx.set(ref, { ct: await encryptItems(fn(cur)), updatedAt: fs.serverTimestamp() });
      });
    }
  };
}

let store = null;
let items = [];
let editingId = null;

function getMe() { try { return localStorage.getItem(ME_KEY); } catch { return null; } }
function setMe(v) { try { localStorage.setItem(ME_KEY, v); } catch {} renderMe(); }
function renderMe() {
  const me = getMe();
  document.querySelectorAll('.me button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.me === me)));
}
document.querySelectorAll('.me button').forEach((b) => b.addEventListener('click', () => setMe(b.dataset.me)));

async function initBucket() {
  renderMe();
  const status = $('status');
  if (isConfigured()) {
    try {
      store = await firestoreStore((e) => { console.error(e); status.textContent = '⚠️ 버킷리스트를 불러오지 못했어. 인터넷 연결이나 Firebase 설정을 확인해 줘.'; });
      status.textContent = '';
    } catch (e) {
      console.error(e);
      status.textContent = '⚠️ Firebase에 연결하지 못해서 이 기기에만 저장 중이야.';
      store = localStore();
    }
  } else {
    status.textContent = '🛠️ Firebase 설정 전이라 지금은 이 기기에만 저장돼.';
    store = localStore();
  }
  store.subscribe((next) => { items = next; renderBucket(); });
}

async function mutate(fn) {
  try { await store.mutate(fn); }
  catch (e) { console.error(e); $('status').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; }
}

function renderBucket() {
  const list = $('list');
  list.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '같이 하고 싶은 걸 첫 번째로 적어 봐 ✏️';
    li.style.fontFamily = 'var(--hand)'; li.style.fontSize = '1.2rem';
    list.appendChild(li);
  }
  items.forEach((it) => {
    const li = document.createElement('li'); if (it.done) li.className = 'done';

    const c = document.createElement('button'); c.className = 'check'; c.type = 'button';
    c.setAttribute('aria-label', it.done ? '완료 취소' : '완료로 표시');
    c.textContent = it.done ? '♥' : '';
    c.onclick = () => mutate((cur) => cur.map((x) => x.id === it.id ? { ...x, done: !x.done } : x));

    const who = document.createElement('span');
    who.className = 'who ' + (it.by || '');
    who.textContent = it.by === 'bear' ? '🐻' : it.by === 'bunny' ? '🐰' : '♥';
    who.title = it.by === 'bear' ? '곰돌찡이 추가' : it.by === 'bunny' ? '토끼찡이 추가' : '';

    let t;
    if (editingId === it.id) {
      t = document.createElement('input'); t.className = 'edit-in'; t.value = it.text; t.maxLength = 80;
      t.setAttribute('aria-label', '항목 수정');
      const finish = (save) => {
        if (editingId !== it.id) return;
        editingId = null;
        const v = t.value.trim();
        if (save && v && v !== it.text) mutate((cur) => cur.map((x) => x.id === it.id ? { ...x, text: v } : x));
        else renderBucket();
      };
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      t.addEventListener('blur', () => finish(true));
      setTimeout(() => t.focus(), 0);
    } else {
      t = document.createElement('span'); t.className = 'txt'; t.textContent = it.text;
    }

    const ed = document.createElement('button'); ed.className = 'tool'; ed.type = 'button';
    ed.setAttribute('aria-label', '수정'); ed.textContent = '✎';
    ed.onclick = () => { editingId = it.id; renderBucket(); };

    const d = document.createElement('button'); d.className = 'tool'; d.type = 'button';
    d.setAttribute('aria-label', '삭제'); d.textContent = '✕';
    d.onclick = () => { if (confirm(`"${it.text}" 지울까?`)) mutate((cur) => cur.filter((x) => x.id !== it.id)); };

    li.append(c, who, t, ed, d);
    list.appendChild(li);
  });
  const done = items.filter((i) => i.done).length;
  $('count').textContent = `${items.length}개 중 ${done}개 완료`;
  $('bar').style.width = items.length ? (done / items.length * 100) + '%' : '0';
}

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('newItem');
  const v = input.value.trim();
  if (!v || !store) return;
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: v, done: false, by: getMe() || '', at: Date.now() };
  input.value = '';
  mutate((cur) => [...cur, item]);
});

boot();
