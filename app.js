import * as CFG from './config.js';
import { QUESTIONS } from './questions.js?v=1';
import { LogGame } from './games/logroll.js?v=1';
import { BallGame } from './games/ballcatch.js?v=2';
import { HurdleGame } from './games/hurdle.js?v=1';
import { SortGame } from './games/sort.js?v=2';

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
  initCalendar();
  initRecipes();
  initEmoticon();
  initDotNav();
  initQna();
  initPush();
  initSettings();
  initPet();
  initGrape();
  initFarm();
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

/* ====================== 설정 (오른쪽 위 ⚙️) ====================== */
// 둘이 같이 쓰는 설정: couples/{sha256(docId + ':settings')} = 암호화된 { start, firstDay, bearBday, bunnyBday }  → 상대 화면도 같이 바뀜
// 이 기기 설정: localStorage ("나는 누구?", 사진 올릴 때 기본값)
// 새 설정을 넣을 땐: 같이 쓰는 거면 normSet()에 기본값 추가, 기기 것이면 prefs()에 추가
const SET_CACHE = 'couple-settings-cache';   // 다음에 열 때 깜빡임 없이 바로 보이게
const PREF_KEY = 'couple-prefs';
const lsRead = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lsWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00'));
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rawSet = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const normSet = (v) => {
  const o = rawSet(v);
  return {
    start: isYmd(o.start) ? o.start : START_DATE,   // 만난 날
    firstDay: o.firstDay !== false,                  // 만난 날 = 1일 (끄면 0일부터)
    bday: {                                          // 생일 (양력, YYYY-MM-DD) → 달력에 매년 자동 표시
      bear: isYmd(o.bearBday) ? o.bearBday : null,
      bunny: isYmd(o.bunnyBday) ? o.bunnyBday : null,
    },
  };
};
const sett = { store: null, data: normSet(lsRead(SET_CACHE, null)) };
const prefs = () => { const p = rawSet(lsRead(PREF_KEY, {})); return { film: p.film !== false, stamp: p.stamp !== false }; };
const ymdToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// 만난 날부터 d날짜까지 며칠째인지 (설정 따라 1일/0일부터)
const dayNumber = (d) => Math.round((d - ymdToDate(sett.data.start)) / 86400000) + (sett.data.firstDay ? 1 : 0);
const BDAY_WHO = [['bear', '🐻', '곰돌찡'], ['bunny', '🐰', '토끼찡']];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// 그해의 생일 날짜 (2월 29일생은 평년엔 2월 28일)
function bdayIn(year, b) {
  const [, m, d] = b.split('-').map(Number);
  return new Date(year, m - 1, m === 2 && d === 29 && !isLeap(year) ? 28 : d);
}
// d날짜가 누구 생일인지: [{ who, icon, name, nth }]  (nth = 몇 번째 생일)
function bdaysOn(d) {
  const out = [];
  for (const [who, icon, name] of BDAY_WHO) {
    const b = sett.data.bday[who];
    if (!b) continue;
    const by = Number(b.slice(0, 4)), y = d.getFullYear();
    if (y > by && bdayIn(y, b).getTime() === d.getTime()) out.push({ who, icon, name, nth: y - by });
  }
  return out;
}
// 오늘부터 가장 가까운 생일: { who, icon, name, date, dd } | null
function nextBday(today) {
  let best = null;
  for (const [who, icon, name] of BDAY_WHO) {
    const b = sett.data.bday[who];
    if (!b) continue;
    let date = bdayIn(today.getFullYear(), b);
    if (date < today) date = bdayIn(today.getFullYear() + 1, b);
    const dd = Math.round((date - today) / 86400000);
    if (!best || dd < best.dd) best = { who, icon, name, date, dd };
  }
  return best;
}

/* ====================== 만난 지 며칠 ====================== */
let ddayTimer = 0;
function renderDday() {
  clearTimeout(ddayTimer);
  const start = ymdToDate(sett.data.start);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const el = $('dday');
  if (today < start) el.hidden = true;
  else {
    const day = dayNumber(today);
    const years = today.getFullYear() - start.getFullYear();
    let extra = '';
    if (today.getMonth() === start.getMonth() && today.getDate() === start.getDate() && years > 0) extra = ` 오늘 ${years}주년이야 🎉`;
    else if (day > 0 && day % 100 === 0) extra = ' 🎉';
    if (bdaysOn(today).length) extra += ' 🎂';
    el.innerHTML = '';
    el.append('우리 만난 지 ');
    const b = document.createElement('b'); b.textContent = day.toLocaleString('ko-KR');
    el.append(b, '일!' + extra);
    el.hidden = false;
  }
  // 자정이 지나면 자동으로 하루 올리기
  const next = new Date(today); next.setDate(next.getDate() + 1);
  ddayTimer = setTimeout(renderDday, next - now + 1000);
}
renderDday();

function applySettings(v) {
  sett.data = normSet(v);
  lsWrite(SET_CACHE, sett.data);
  renderDday();
  if (cal.view) renderCalendar();   // 달력의 100일·주년 표시
  if (!$('setSheet').hidden && !(document.activeElement && document.activeElement.matches('#setSheet input[type="date"]'))) fillSettings();
  for (const [who] of BDAY_WHO) $(who + 'BdayX').hidden = !sett.data.bday[who];   // 입력 중이어도 ✕는 바로
}
async function saveSettings(patch) {
  applySettings({ ...sett.data, ...patch });   // 내 화면엔 바로
  if (!sett.store) return;
  try { await sett.store.mutate((cur) => ({ ...rawSet(cur), ...patch })); $('setStatus').textContent = '저장했어 ✓'; }
  catch (e) { console.error(e); $('setStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; }
}
async function initSettings() {
  renderMe();
  sett.store = await openStore(await sha256hex(state.docId + ':settings'), 'couple-settings-local', $('setStatus'), '설정');
  sett.store.subscribe((v) => applySettings(v));
}

function fillSettings() {
  $('setStart').value = sett.data.start;
  $('setStart').max = localYmd();
  $('setFirstDay').checked = sett.data.firstDay;
  for (const [who] of BDAY_WHO) {
    const inp = $(who + 'Bday');
    inp.value = sett.data.bday[who] || ''; inp.max = localYmd();
    $(who + 'BdayX').hidden = !sett.data.bday[who];
  }
  const p = prefs();
  $('prefFilm').checked = p.film; $('prefStamp').checked = p.stamp;
  renderLayoutSettings();
  renderMe();
}
function openSettings() {
  $('setStatus').textContent = '';
  fillSettings();
  $('setSheet').hidden = false;
  $('gearBtn').setAttribute('aria-expanded', 'true');
  $('setClose').focus();
}
function closeSettings() {
  $('setSheet').hidden = true;
  $('gearBtn').setAttribute('aria-expanded', 'false');
}
$('gearBtn').addEventListener('click', openSettings);
$('setClose').addEventListener('click', closeSettings);
$('setDone').addEventListener('click', closeSettings);
$('setSheet').addEventListener('click', (e) => { if (e.target === $('setSheet')) closeSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('setSheet').hidden) closeSettings(); });
$('setStart').addEventListener('change', () => {
  const v = $('setStart').value;
  if (!isYmd(v)) return;
  if (v > localYmd()) { $('setStatus').textContent = '⚠️ 오늘 이후 날짜는 고를 수 없어'; $('setStart').value = sett.data.start; return; }
  if (v !== sett.data.start) saveSettings({ start: v });
});
$('setFirstDay').addEventListener('change', () => saveSettings({ firstDay: $('setFirstDay').checked }));
for (const [who] of BDAY_WHO) {
  const inp = $(who + 'Bday'), key = who + 'Bday';
  inp.addEventListener('change', () => {
    const v = inp.value;
    if (v && !isYmd(v)) return;
    if (v > localYmd()) { $('setStatus').textContent = '⚠️ 오늘 이후 날짜는 고를 수 없어'; inp.value = sett.data.bday[who] || ''; return; }
    if ((v || null) !== sett.data.bday[who]) saveSettings({ [key]: v || null });
  });
  $(who + 'BdayX').addEventListener('click', () => { inp.value = ''; saveSettings({ [key]: null }); });
}
['prefFilm', 'prefStamp'].forEach((id) => $(id).addEventListener('change', () =>
  lsWrite(PREF_KEY, { film: $('prefFilm').checked, stamp: $('prefStamp').checked })));
// "나는 누구?"가 바뀌면 그걸 쓰는 화면들 다시 그리기
document.addEventListener('mechange', () => {
  for (const f of [renderQna, renderRecipes, renderGrape]) { try { f(); } catch {} }
  try { if (!$('emoPop').hidden) renderEmoPop(); } catch {}
  try { renderPush().catch(() => {}); } catch {}
});

/* ====================== 하트 (섹션 3) ====================== */
(() => {
  const t = $('together');
  if (!('IntersectionObserver' in window)) { t.classList.add('seen'); return; }
  new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('seen', e.isIntersecting)),
    { root: $('scroller'), threshold: 0.6 }).observe(t);
})();

/* ====================== 갤러리 ====================== */
// 두 종류의 사진이 날짜순으로 섞여 보여:
//  - static: encrypt_photos.py 로 올린 사진 (gallery/*.enc → GitHub)
//  - cloud : 폰에서 바로 찍거나 골라서 올린 사진 (Firestore photos/{랜덤 64hex}, 암호화)
//    사진 목록은 couples/{sha256(docId + ':photos')} 에 암호화된 배열로 저장
async function fetchDecrypt(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return decryptBytes(state.key, new Uint8Array(await r.arrayBuffer()));
}
const toURL = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
const sha256hex = async (str) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(str))));
const thumbIdOf = (id) => sha256hex(id + ':thumb');
const normDate = (d) => String(d || '').replace(/-/g, '.');   // 표시·정렬용 YYYY.MM.DD

const gal = { static: [], cloud: [], store: null, remote: false, urls: new Map(), io: null, expanded: false, lastCount: 0 };
const GAL_STRIP_MIN = 4;

async function photoDocGet(id) {
  const { fs, db } = await getDb();
  const snap = await fs.getDoc(fs.doc(db, 'photos', id));
  if (!snap.exists()) throw new Error('missing photo ' + id.slice(0, 8));
  return decryptBytes(state.key, b64.from(snap.data().ct));
}
async function photoDocPut(id, bytes) {
  const { fs, db } = await getDb();
  const ct = b64.to(await encryptBytes(state.key, bytes));
  await fs.setDoc(fs.doc(db, 'photos', id), { ct, createdAt: fs.serverTimestamp() });
}
async function photoDocDel(id) {
  const { fs, db } = await getDb();
  await fs.deleteDoc(fs.doc(db, 'photos', id));
}

function setUploadEnabled(on) { $('upBtns').setAttribute('aria-disabled', String(!on)); }

async function initGallery() {
  try {
    const r = await fetch('gallery/manifest.enc', { cache: 'no-cache' });
    if (r.ok) {
      const list = JSON.parse(td.decode(await decryptBytes(state.key, new Uint8Array(await r.arrayBuffer()))));
      gal.static = list.map((p) => ({ kind: 'static', key: 's:' + p.id, id: p.id, date: normDate(p.date), caption: p.caption || '' }));
    }
  } catch (e) { console.error(e); }
  renderGallery();

  const status = $('galStatus');
  if (!isConfigured()) {
    status.textContent = '🛠️ Firebase 설정 전이라 폰에서 올리기는 아직 못 써.';
    setUploadEnabled(false);
    petSeen('photo');
    return;
  }
  try {
    gal.store = await firestoreStore(await sha256hex(state.docId + ':photos'), (e) => {
      console.error(e); status.textContent = '⚠️ 올린 사진 목록을 불러오지 못했어. 인터넷 연결을 확인해 줘.';
    });
    gal.remote = true;
    gal.store.subscribe((next) => {
      gal.cloud = (Array.isArray(next) ? next : []).map((it) => ({
        kind: 'cloud', key: 'c:' + it.id, id: it.id, date: normDate(it.date), caption: it.cap || '', by: it.by || '', at: it.at || 0
      }));
      renderGallery();
      petSeen('photo');
    });
  } catch (e) {
    console.error(e);
    status.textContent = '⚠️ Firebase에 연결하지 못해서 지금은 사진을 올릴 수 없어.';
    setUploadEnabled(false);
    petSeen('photo');
  }
}

function renderGallery() {
  const grid = $('grid');
  const all = [...gal.cloud, ...gal.static]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  if (gal.io) gal.io.disconnect();
  grid.innerHTML = '';
  // 4장 이상이면 한 줄로 옆으로 넘기기 (전체 보기를 누르면 원래처럼 바둑판)
  const strip = all.length >= GAL_STRIP_MIN && !gal.expanded;
  const grew = all.length > gal.lastCount; gal.lastCount = all.length;
  grid.classList.toggle('strip', strip);
  $('galTools').hidden = all.length < GAL_STRIP_MIN;
  $('galHint').hidden = !strip; $('galPrev').hidden = !strip; $('galNext').hidden = !strip;
  $('galTrack').hidden = !strip;
  $('galAll').textContent = gal.expanded ? '접기' : '전체 보기';
  $('galAll').setAttribute('aria-expanded', String(gal.expanded));

  if (!all.length) {
    const e = document.createElement('div');
    e.className = 'empty'; e.style.gridColumn = '1 / -1';
    e.textContent = '첫 사진을 올려 봐 📷';
    grid.appendChild(e);
    $('galSub').textContent = '우리가 같이 찍은 사진들';
    return;
  }
  $('galSub').textContent = `우리가 같이 찍은 사진 ${all.length}장`;

  // 썸네일은 보일 때만 복호화: 옆으로 넘기기 모드에선 좌우 400px 미리
  gal.io = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => es.forEach((en) => {
        if (en.isIntersecting) { gal.io.unobserve(en.target); loadThumb(en.target); }
      }), strip ? { root: grid, rootMargin: '0px 400px' } : { root: $('scroller'), rootMargin: '300px' })
    : null;

  all.forEach((p) => {
    const f = document.createElement('figure');
    f.className = 'ph'; f.style.margin = 0; f.tabIndex = 0; f._item = p;
    const im = document.createElement('img'); im.alt = (p.caption || p.date) + ' 사진';
    const cap = document.createElement('span');
    if (p.by) { const b = document.createElement('i'); b.className = 'by'; b.textContent = p.by === 'bear' ? '🐻' : '🐰'; cap.appendChild(b); }
    cap.append(p.caption ? `${p.caption} · ${p.date}` : p.date);
    f.append(im, cap);
    const open = () => openPhoto(p, im.alt);
    f.addEventListener('click', open);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    grid.appendChild(f);
    const cached = gal.urls.get(p.key);
    if (cached) { im.onload = () => im.classList.add('ready'); im.src = cached; }
    else if (gal.io) gal.io.observe(f);
    else loadThumb(f);
  });
  if (strip && grew) grid.scrollLeft = 0;   // 새로 올린 사진(맨 앞)이 바로 보이게
  requestAnimationFrame(updateGalTrack);
}

// 옆으로 넘기기: 아래 진행 막대 + 컴퓨터용 ‹ › 버튼 + 전체 보기
function updateGalTrack() {
  const g = $('grid'), bar = $('galTrack').firstElementChild;
  if (!g.classList.contains('strip')) return;
  const w = g.scrollWidth || 1;
  bar.style.width = `${Math.min(100, (g.clientWidth / w) * 100)}%`;
  bar.style.marginLeft = `${(g.scrollLeft / w) * 100}%`;
  $('galHint').classList.toggle('done', g.scrollLeft > 24);
}
$('grid').addEventListener('scroll', () => requestAnimationFrame(updateGalTrack), { passive: true });
window.addEventListener('resize', updateGalTrack);
$('galPrev').addEventListener('click', () => $('grid').scrollBy({ left: -$('grid').clientWidth * 0.9, behavior: 'smooth' }));
$('galNext').addEventListener('click', () => $('grid').scrollBy({ left: $('grid').clientWidth * 0.9, behavior: 'smooth' }));
$('galAll').addEventListener('click', () => {
  gal.expanded = !gal.expanded;
  renderGallery();
  if (!gal.expanded) {   // 접으면 갤러리 맨 위로 돌아오기
    const sec = document.querySelector('.scene[data-nav="갤러리"]');
    if (sec) $('scroller').scrollTo({ top: sec.offsetTop, behavior: 'smooth' });
  }
});

async function loadThumb(fig) {
  const p = fig._item, im = fig.querySelector('img');
  try {
    let url = gal.urls.get(p.key);
    if (!url) {
      const bytes = p.kind === 'static'
        ? await fetchDecrypt(`gallery/${p.id}_t.enc`)
        : await photoDocGet(await thumbIdOf(p.id));
      url = toURL(bytes);
      gal.urls.set(p.key, url);
    }
    im.onload = () => im.classList.add('ready');
    im.src = url;
  } catch (e) { console.error(e); }
}

const lb = $('lightbox'), lbImg = $('lbImg');
let lbItem = null;
async function openPhoto(p, alt) {
  lbItem = p;
  lbImg.removeAttribute('src'); lbImg.alt = alt;
  $('lbCap').textContent = [p.caption, p.date].filter(Boolean).join(' · ');
  $('lbDel').hidden = p.kind !== 'cloud';
  lb.classList.add('open');
  $('lbClose').focus();
  try {
    const bytes = p.kind === 'static' ? await fetchDecrypt(`gallery/${p.id}.enc`) : await photoDocGet(p.id);
    if (lbItem !== p) return;
    const url = toURL(bytes);
    if (lbImg.dataset.url) URL.revokeObjectURL(lbImg.dataset.url);
    lbImg.dataset.url = url; lbImg.src = url;
  } catch (e) { console.error(e); $('lbCap').textContent = '⚠️ 사진을 불러오지 못했어'; }
}
const closeLb = () => { lb.classList.remove('open'); lbItem = null; };
$('lbClose').onclick = closeLb;
lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
$('lbDel').onclick = async () => {
  const p = lbItem;
  if (!p || p.kind !== 'cloud' || !gal.store) return;
  if (!confirm('이 사진 지울까? 둘 다한테서 없어지고 되돌릴 수 없어.')) return;
  closeLb();
  try {
    await gal.store.mutate((cur) => cur.filter((x) => x.id !== p.id));   // 목록에서 먼저 빼고
    await Promise.allSettled([photoDocDel(p.id), thumbIdOf(p.id).then(photoDocDel)]);   // 사진 본체 삭제
    const u = gal.urls.get(p.key); if (u) { URL.revokeObjectURL(u); gal.urls.delete(p.key); }
  } catch (e) { console.error(e); $('galStatus').textContent = '⚠️ 지우지 못했어. 잠시 후 다시 해 줘.'; }
};

/* ====================== 사진 올리기 (필름 카메라 느낌) ====================== */
const FULL_LONG = 1280;      // 긴 변 px (필름 느낌이라 일부러 작게)
const THUMB_LONG = 420;
const MAX_BYTES = 700000;    // 암호화+base64 후 Firestore 문서 1MiB 안에 들어가는 크기
const MAX_FILES = 10;
const up = { items: [], busy: false };

// 사진 찍은 날짜: JPEG EXIF DateTimeOriginal → 없으면 파일 날짜 → 없으면 오늘
async function exifDate(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {   // "Exif"
        const t = off + 10, le = v.getUint16(t) === 0x4949;
        const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
        const ifd = (o) => {
          const tags = {}, n = u16(o);
          for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; }
          return tags;
        };
        const str = (tag) => {
          const o = tag.count > 4 ? u32(tag.at) : tag.at;
          let s = ''; for (let i = 0; i < Math.min(tag.count, 32) - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i));
          return s;
        };
        const ifd0 = ifd(u32(4));
        let raw = null;
        if (ifd0[0x8769]) { const ex = ifd(u32(ifd0[0x8769].at)); if (ex[0x9003]) raw = str(ex[0x9003]); }
        if (!raw && ifd0[0x0132]) raw = str(ifd0[0x0132]);
        const m = raw && raw.match(/^(\d{4}):(\d{2}):(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
      }
      off += 2 + len;
    }
  } catch {}
  return null;
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했어')); };
    img.src = url;
  });
}
// 브라우저가 EXIF 회전을 적용해서 그려 줌. 다시 그리면서 EXIF(GPS 위치 등)는 사라짐.
function resizeTo(source, w0, h0, long) {
  let k = Math.min(1, long / Math.max(w0, h0));
  let cur = source, cw = w0, ch = h0;
  // 한 번에 크게 줄이면 계단 현상 → 절반씩 줄이기
  while (cw * k < cw / 2) {
    const c = document.createElement('canvas'); c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    c.getContext('2d').drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height; k = Math.min(1, long / Math.max(cw, ch));
  }
  const out = document.createElement('canvas'); out.width = Math.round(cw * k); out.height = Math.round(ch * k);
  const x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}
async function toSourceCanvas(file) {
  const { img, url } = await loadImage(file);
  try { return resizeTo(img, img.naturalWidth, img.naturalHeight, FULL_LONG); }
  finally { URL.revokeObjectURL(url); }
}

function prng(seed) {   // mulberry32: 사진마다 그레인/빛샘이 미리보기와 똑같이 나오게
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawStamp(ctx, W, H, date) {
  const [y, m, d] = date.split('-');
  const txt = `'${y.slice(2)} ${m} ${d}`;
  const fs = Math.max(14, Math.round(Math.min(W, H) * 0.055));
  ctx.save();
  ctx.font = `bold ${fs}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  const x = W - fs * 0.9, yy = H - fs * 0.8;
  ctx.shadowColor = 'rgba(255,70,0,.9)'; ctx.shadowBlur = fs * 0.4;
  ctx.fillStyle = '#FF9A3C'; ctx.fillText(txt, x, yy);
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,214,160,.6)'; ctx.fillText(txt, x, yy);
  ctx.restore();
}

function renderPhoto(item, opts) {
  const { src } = item, W = src.width, H = src.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  if (opts.film) {
    const rnd = prng(item.seed);
    const im = ctx.getImageData(0, 0, W, H), px = im.data;
    for (let i = 0; i < px.length; i += 4) {
      let r = px[i], g = px[i + 1], b = px[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * 0.8; g = l + (g - l) * 0.8; b = l + (b - l) * 0.8;          // 채도 살짝 낮게
      r = (r - 128) * 0.86 + 142; g = (g - 128) * 0.86 + 134; b = (b - 128) * 0.86 + 122; // 대비↓ + 따뜻하게
      r = r * 0.93 + 14; g = g * 0.93 + 14; b = b * 0.93 + 18;                        // 검정 살짝 들뜨게 (바랜 느낌)
      const n = (rnd() + rnd() - 1) * 16;                                               // 필름 그레인
      px[i] = r + n; px[i + 1] = g + n; px[i + 2] = b + n;                              // (자동으로 0~255로 잘림)
    }
    ctx.putImageData(im, 0, 0);
    // 비네팅
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(35,18,0,.42)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // 빛샘 (사진마다 위치가 달라)
    const lx = rnd() < 0.5 ? 0 : W, ly = rnd() * H * 0.6, R = Math.max(W, H) * 0.55;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
    lg.addColorStop(0, 'rgba(255,140,60,.30)'); lg.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (opts.stamp) drawStamp(ctx, W, H, item.date);
  return c;
}

const canvasToBytes = (c, q) => new Promise((res, rej) =>
  c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error('toBlob 실패'))), 'image/jpeg', q));
const shrink = (c, long) => (Math.max(c.width, c.height) <= long ? c : resizeTo(c, c.width, c.height, long));
async function encodeFull(c) {
  for (const [long, q] of [[FULL_LONG, 0.82], [FULL_LONG, 0.7], [1080, 0.68], [900, 0.6]]) {
    const bytes = await canvasToBytes(shrink(c, long), q);
    if (bytes.length <= MAX_BYTES) return bytes;
  }
  throw new Error('사진이 너무 커');
}

const curOpts = () => ({ film: $('optFilm').checked, stamp: $('optStamp').checked });

function renderPreviews() {
  const box = $('upPreviews');
  box.innerHTML = '';
  box.className = 'up-previews ' + (up.items.length > 1 ? 'many' : 'one');
  const opts = curOpts();
  up.items.forEach((it) => box.appendChild(renderPhoto(it, opts)));
  $('upDateRow').hidden = up.items.length !== 1;
  if (up.items.length === 1) $('upDate').value = up.items[0].date;
}

async function openSheet(files, fromCamera, tooMany) {
  const sheet = $('upSheet'), msg = $('upMsg'), go = $('upGo');
  up.items = [];
  $('upPreviews').innerHTML = '';
  $('upCap').value = '';
  const p = prefs(), me = getMe();
  $('optFilm').checked = p.film; $('optStamp').checked = p.stamp;   // ⚙️ 설정의 기본값
  $('upBy').textContent = me ? `올리는 건 ${WHO[me].icon} ${WHO[me].name}` : '⚙️ 설정에서 "나는 누구?"를 고르면 누가 올렸는지 같이 남아';
  sheet.hidden = false;
  go.disabled = true;
  msg.textContent = '사진 준비 중…';
  const today = todayYmd();
  for (const f of files) {
    try {
      const date = (fromCamera ? today : null) || await exifDate(f) || (f.lastModified ? ymd(new Date(f.lastModified)) : today);
      up.items.push({ src: await toSourceCanvas(f), date, seed: (Math.random() * 2 ** 31) | 0 });
    } catch (e) { console.error(e); }
    if (sheet.hidden) return;   // 준비 중에 취소함
  }
  if (!up.items.length) { msg.textContent = '⚠️ 사진을 읽지 못했어. 다른 사진으로 해 줘.'; return; }
  renderPreviews();
  msg.textContent = tooMany ? `한 번에 ${MAX_FILES}장까지라 앞의 ${MAX_FILES}장만 골랐어.` : '';
  go.disabled = false;
}

function closeSheet() {
  if (up.busy) return;
  $('upSheet').hidden = true;
  $('upPreviews').innerHTML = '';
  up.items = [];
}

async function doUpload() {
  if (up.busy || !up.items.length || !gal.store) return;
  up.busy = true;
  const go = $('upGo'), msg = $('upMsg');
  go.disabled = true;
  const cap = $('upCap').value.trim().slice(0, 30), by = getMe() || '', opts = curOpts();
  const total = up.items.length;
  try {
    while (up.items.length) {
      const it = up.items[0];
      msg.textContent = total > 1 ? `올리는 중… ${total - up.items.length + 1}/${total}` : '올리는 중…';
      const out = renderPhoto(it, opts);
      const full = await encodeFull(out);
      const thumb = await canvasToBytes(shrink(out, THUMB_LONG), 0.72);
      const id = hex(crypto.getRandomValues(new Uint8Array(32)));
      await photoDocPut(id, full);
      await photoDocPut(await thumbIdOf(id), thumb);
      gal.urls.set('c:' + id, toURL(thumb));   // 방금 올린 건 다시 안 받아도 바로 보이게
      const entry = { id, date: it.date, cap, by, at: Date.now() };
      await gal.store.mutate((cur) => [...(Array.isArray(cur) ? cur : []), entry]);
      up.items.shift();   // 한 장씩 목록까지 저장 → 중간에 실패해도 다시 누르면 남은 것만 올라감
    }
    up.busy = false;
    closeSheet();
    $('galStatus').textContent = '';
    notifyPartner('photo', { n: total });
  } catch (e) {
    console.error(e);
    up.busy = false;
    msg.textContent = '⚠️ 올리지 못했어. 인터넷 연결을 확인하고 다시 눌러 줘.';
    if (up.items.length) { renderPreviews(); go.disabled = false; }
  }
}

function onPick(e) {
  const input = e.target;
  const files = [...input.files];
  input.value = '';   // 같은 사진을 다시 골라도 동작하게
  if (!files.length) return;
  if (!gal.remote) { $('galStatus').textContent = '⚠️ 지금은 사진을 올릴 수 없어 (Firebase 연결 필요).'; return; }
  openSheet(files.slice(0, MAX_FILES), input.id === 'camInput', files.length > MAX_FILES);
}
$('camInput').addEventListener('change', onPick);
$('pickInput').addEventListener('change', onPick);
$('optFilm').addEventListener('change', renderPreviews);
$('optStamp').addEventListener('change', renderPreviews);
$('upDate').addEventListener('change', () => {
  const v = $('upDate').value;
  if (up.items.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(v)) { up.items[0].date = v; renderPreviews(); }
});
$('upCancel').addEventListener('click', closeSheet);
$('upGo').addEventListener('click', doUpload);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('upSheet').hidden) closeSheet(); else closeLb();
});

/* ====================== 버킷리스트 (같이 수정, 내용 암호화) ====================== */
const isConfigured = () => !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

async function encryptItems(items) { return b64.to(await encryptBytes(state.key, te.encode(JSON.stringify(items)))); }
async function decryptItems(ct) { return JSON.parse(td.decode(await decryptBytes(state.key, b64.from(ct)))); }

// Firebase 설정 전: 이 기기에만 저장 (테스트용)
function localStore(K) {
  let listener = () => {};
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch { return []; } };
  return {
    subscribe(cb) { listener = cb; cb(load()); },
    async mutate(fn) { const next = fn(load()); try { localStorage.setItem(K, JSON.stringify(next)); } catch {} listener(next); }
  };
}

// Firebase 앱은 한 번만 만들고 버킷리스트·일정이 같이 써
let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const fs = await import(`${base}/firebase-firestore.js`);
    return { fs, db: fs.getFirestore(initializeApp(FIREBASE_CONFIG)) };
  })();
  return dbPromise;
}

async function firestoreStore(docId, onError) {
  const { fs, db } = await getDb();
  const ref = fs.doc(db, 'couples', docId);
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
function setMe(v) {
  const changed = getMe() !== v;
  try { localStorage.setItem(ME_KEY, v); } catch {}
  renderMe();
  if (changed) document.dispatchEvent(new Event('mechange'));
}
function renderMe() {
  const me = getMe();
  document.querySelectorAll('.me button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.me === me)));
  if ($('gearDot')) $('gearDot').hidden = !!me;   // 아직 안 골랐으면 ⚙️에 빨간 점
}
document.querySelectorAll('.me button').forEach((b) => b.addEventListener('click', () => setMe(b.dataset.me)));

// Firestore 문서 하나 = 암호화된 JSON 배열 하나. 실패하면 이 기기에만 저장.
async function openStore(docId, localKey, status, name) {
  if (isConfigured()) {
    try {
      const st = await firestoreStore(docId, (e) => { console.error(e); status.textContent = `⚠️ ${name}을(를) 불러오지 못했어. 인터넷 연결이나 Firebase 설정을 확인해 줘.`; });
      status.textContent = '';
      return st;
    } catch (e) {
      console.error(e);
      status.textContent = '⚠️ Firebase에 연결하지 못해서 이 기기에만 저장 중이야.';
    }
  } else {
    status.textContent = '🛠️ Firebase 설정 전이라 지금은 이 기기에만 저장돼.';
  }
  return localStore(localKey);
}

async function initBucket() {
  renderMe();
  store = await openStore(state.docId, 'couple-bucket-local', $('status'), '버킷리스트');
  store.subscribe((next) => { items = next; renderBucket(); petSeen('bucket'); });
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

/* ====================== 일정 (달력, 같이 수정, 내용 암호화) ====================== */
// 버킷리스트와 같은 방식이지만 Firestore 문서는 따로 (문서 ID = sha256(docId + ':calendar'))
// → firestore.rules 를 바꿀 필요 없음
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = (str) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
const todayYmd = () => ymd(new Date());
const prettyDate = (str) => { const d = parseYmd(str); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };

const cal = { store: null, events: [], view: null, sel: todayYmd(), editId: null };

// 그날의 특별한 날들 (달력에 자동으로): 기념일 + 생일
function specialsOf(str) {
  const out = [];
  const an = annivOf(str);
  if (an) out.push({ pill: an, line: `우리 ${an}`, icon: '♥', cls: 'anniv' });
  bdaysOn(parseYmd(str)).forEach((b) => out.push({
    pill: `🎂${b.name}`, line: `${b.icon} ${b.name} ${b.nth}번째 생일 🎉`, icon: '🎂', cls: 'bday',
  }));
  return out;
}

// 기념일 자동 표시: 100일 단위 + N주년
function annivOf(str) {
  const start = parseYmd(sett.data.start), d = parseYmd(str);
  if (d <= start) return null;
  const day = dayNumber(d);
  const years = d.getFullYear() - start.getFullYear();
  if (years > 0 && d.getMonth() === start.getMonth() && d.getDate() === start.getDate()) return `${years}주년 🎉`;
  if (day % 100 === 0) return `${day}일 🎉`;
  return null;
}

async function initCalendar() {
  if (!$('cal')) return;
  const sel = parseYmd(cal.sel);
  cal.view = new Date(sel.getFullYear(), sel.getMonth(), 1);
  renderCalendar();
  const calDoc = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(state.docId + ':calendar'))));
  cal.store = await openStore(calDoc, 'couple-calendar-local', $('calStatus'), '일정');
  cal.store.subscribe((next) => { cal.events = Array.isArray(next) ? next : []; renderCalendar(); });
}

async function calMutate(fn) {
  try { await cal.store.mutate(fn); }
  catch (e) { console.error(e); $('calStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; }
}

function eventsByDate() {
  const map = {};
  [...cal.events].sort((a, b) => (a.at || 0) - (b.at || 0)).forEach((e) => { (map[e.date] ||= []).push(e); });
  return map;
}

function renderCalendar() {
  const grid = $('cal');
  const by = eventsByDate();
  const y = cal.view.getFullYear(), m = cal.view.getMonth();
  const today = todayYmd();
  $('calTitle').textContent = `${y}년 ${m + 1}월`;

  grid.innerHTML = '';
  WD.forEach((w, i) => {
    const h = document.createElement('div');
    h.className = 'wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    h.textContent = w; h.setAttribute('role', 'columnheader');
    grid.appendChild(h);
  });

  const lead = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const n = i - lead + 1;
    if (n < 1 || n > days) {
      const b = document.createElement('div'); b.className = 'day blank'; b.setAttribute('aria-hidden', 'true');
      grid.appendChild(b); continue;
    }
    const ds = `${y}-${pad2(m + 1)}-${pad2(n)}`;
    const dow = (lead + n - 1) % 7;
    const evs = by[ds] || [];
    const sp = specialsOf(ds);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') +
      (ds === today ? ' today' : '') + (ds === cal.sel ? ' sel' : '');
    cell.setAttribute('aria-label', `${m + 1}월 ${n}일` + sp.map((x) => `, ${x.line}`).join('') + (evs.length ? `, 일정 ${evs.length}개` : ''));
    cell.setAttribute('aria-pressed', String(ds === cal.sel));

    const num = document.createElement('span'); num.className = 'n'; num.textContent = n;
    cell.appendChild(num);

    const pills = [];
    sp.forEach((x) => pills.push({ text: x.pill, cls: x.cls }));
    evs.forEach((e) => pills.push({ text: e.title, cls: e.by || '' }));
    pills.slice(0, 2).forEach((p) => {
      const t = document.createElement('span'); t.className = 'pill ' + p.cls; t.textContent = p.text;
      cell.appendChild(t);
    });
    if (pills.length > 2) {
      const more = document.createElement('span'); more.className = 'more'; more.textContent = `+${pills.length - 2}`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => {
      const again = cal.sel === ds;
      cal.sel = ds; cal.editId = null;
      renderCalendar();
      // 같은 날 두 번 누르거나, 일정 없는 날을 누르면 바로 제목 입력
      if (again || !evs.length) $('calInput').focus({ preventScroll: true });
    });
    grid.appendChild(cell);
  }

  renderCalDay(by);
  renderCalSub();
}

function renderCalDay(by) {
  $('calDayTitle').textContent = prettyDate(cal.sel) + (cal.sel === todayYmd() ? ' · 오늘' : '');
  $('calInput').placeholder = `${prettyDate(cal.sel).replace(/ \(.\)$/, '')}에 뭐 해?`;
  const list = $('calList');
  list.innerHTML = '';

  const sp = specialsOf(cal.sel);
  sp.forEach((x) => {
    const li = document.createElement('li');
    const who = document.createElement('span'); who.className = 'who ' + x.cls; who.textContent = x.icon;
    const t = document.createElement('span'); t.className = 'txt'; t.textContent = x.line;
    li.append(who, t); list.appendChild(li);
  });

  const evs = by[cal.sel] || [];
  if (!evs.length && !sp.length) {
    const li = document.createElement('li');
    li.textContent = '아직 일정이 없어 ✏️';
    li.style.fontFamily = 'var(--hand)'; li.style.fontSize = '1.2rem';
    list.appendChild(li);
  }
  evs.forEach((ev) => {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who ' + (ev.by || '');
    who.textContent = ev.by === 'bear' ? '🐻' : ev.by === 'bunny' ? '🐰' : '♥';
    who.title = ev.by === 'bear' ? '곰돌찡이 추가' : ev.by === 'bunny' ? '토끼찡이 추가' : '';

    let t;
    if (cal.editId === ev.id) {
      t = document.createElement('input'); t.className = 'edit-in'; t.value = ev.title; t.maxLength = 40;
      t.setAttribute('aria-label', '일정 수정');
      const finish = (save) => {
        if (cal.editId !== ev.id) return;
        cal.editId = null;
        const v = t.value.trim();
        if (save && v && v !== ev.title) calMutate((cur) => cur.map((x) => x.id === ev.id ? { ...x, title: v } : x));
        else renderCalendar();
      };
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      t.addEventListener('blur', () => finish(true));
      setTimeout(() => t.focus(), 0);
    } else {
      t = document.createElement('span'); t.className = 'txt'; t.textContent = ev.title;
    }

    const ed = document.createElement('button'); ed.className = 'tool'; ed.type = 'button';
    ed.setAttribute('aria-label', '수정'); ed.textContent = '✎';
    ed.onclick = () => { cal.editId = ev.id; renderCalendar(); };

    const d = document.createElement('button'); d.className = 'tool'; d.type = 'button';
    d.setAttribute('aria-label', '삭제'); d.textContent = '✕';
    d.onclick = () => { if (confirm(`"${ev.title}" 일정 지울까?`)) calMutate((cur) => cur.filter((x) => x.id !== ev.id)); };

    li.append(who, t, ed, d);
    list.appendChild(li);
  });
}

// 다가오는 일정 한 줄
function renderCalSub() {
  const today = todayYmd();
  const next = cal.events.filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.at || 0) - (b.at || 0))[0];
  const sub = $('calSub');
  const dd = next ? Math.round((parseYmd(next.date) - parseYmd(today)) / 86400000) : Infinity;
  const nb = nextBday(parseYmd(today));
  if (nb && nb.dd <= dd) {   // 생일이 더 가까우면 생일 먼저
    sub.textContent = nb.dd === 0 ? `오늘은 ${nb.icon} ${nb.name} 생일! 🎂` : `다음: ${prettyDate(ymd(nb.date))} ${nb.icon} ${nb.name} 생일 🎂 · D-${nb.dd}`;
    return;
  }
  if (!next) { sub.textContent = '날짜를 누르고 일정을 적어 봐'; return; }
  sub.textContent = `다음 일정: ${prettyDate(next.date)} ${next.title} · ${dd === 0 ? '오늘!' : `D-${dd}`}`;
}

function moveMonth(delta) {
  cal.view = new Date(cal.view.getFullYear(), cal.view.getMonth() + delta, 1);
  renderCalendar();
}
if ($('cal')) {
  $('calPrev').addEventListener('click', () => moveMonth(-1));
  $('calNext').addEventListener('click', () => moveMonth(1));
  $('calTitle').addEventListener('click', () => {
    const t = new Date(); cal.sel = todayYmd(); cal.view = new Date(t.getFullYear(), t.getMonth(), 1);
    renderCalendar();
  });
  $('calForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('calInput');
    const v = input.value.trim();
    if (!v || !cal.store) return;
    const ev = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: cal.sel, title: v, by: getMe() || '', at: Date.now() };
    input.value = '';
    calMutate((cur) => [...(Array.isArray(cur) ? cur : []), ev]).then(() => notifyPartner('cal'));
  });
}

/* ====================== 우리들의 레시피 ====================== */
// 메뉴 + 레시피 링크 + 별점(1~5, 0 = 아직 안 먹어봄). 버킷리스트처럼 같이 수정, 내용 암호화.
// 저장: couples/{sha256(docId + ':recipes')} = 암호화된 [{ id, name, url, stars, by, at }]
const RC_SORT_KEY = 'couple-recipe-sort';
const rc = { store: null, items: [], editId: null, noteId: null, sort: 'new' };
try { rc.sort = localStorage.getItem(RC_SORT_KEY) || 'new'; } catch {}

// http/https 링크만 허용 (javascript: 같은 건 거절). 공유 문구에 섞인 링크도 뽑아냄.
function cleanUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  let u = m ? m[0] : text;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(u)) u = 'https://' + u;   // "youtu.be/abc" 처럼 입력해도 OK
    else return null;
  }
  try {
    const x = new URL(u);
    return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null;
  } catch { return null; }
}
function srcLabel(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m)\./, '');
    const known = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', '10000recipe.com': '만개의레시피',
      'instagram.com': 'Instagram', 'blog.naver.com': '네이버 블로그', 'naver.com': '네이버', 'tiktok.com': 'TikTok' };
    return known[h] || h;
  } catch { return ''; }
}

async function initRecipes() {
  if (!$('rcList')) return;
  rc.store = await openStore(await sha256hex(state.docId + ':recipes'), 'couple-recipes-local', $('rcStatus'), '레시피');
  rc.store.subscribe((next) => {
    rc.items = Array.isArray(next) ? next : [];
    petSeen('recipe');
    // 수정 중에 상대방이 바꾼 게 들어와도 입력하던 글자가 날아가지 않게, 수정 끝나고 다시 그림
    if ((rc.editId || rc.noteId) && $('rcList').contains(document.activeElement)) return;
    renderRecipes();
  });
}

async function rcMutate(fn) {
  try { await rc.store.mutate((cur) => fn(Array.isArray(cur) ? cur : [])); }
  catch (e) { console.error(e); $('rcStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; }
}

function starButtons(it) {
  const box = document.createElement('span');
  box.className = 'rc-stars'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', '얼마나 맛있었어?');
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = '★';
    b.className = n <= (it.stars || 0) ? 'on' : '';
    b.setAttribute('aria-label', `별 ${n}개`);
    b.setAttribute('aria-pressed', String((it.stars || 0) === n));
    // 같은 별을 한 번 더 누르면 0개 (아직 안 먹어봄)
    b.onclick = () => rcMutate((cur) => cur.map((x) => x.id === it.id ? { ...x, stars: (x.stars || 0) === n ? 0 : n } : x));
    box.appendChild(b);
  }
  return box;
}

function renderRecipes() {
  const list = $('rcList');
  list.innerHTML = '';
  const all = [...rc.items].sort((a, b) => (b.at || 0) - (a.at || 0));   // 기본: 최신 순
  const tried = all.filter((x) => x.stars > 0);
  const avg = tried.length ? (tried.reduce((s, x) => s + x.stars, 0) / tried.length) : 0;
  $('rcSub').textContent = all.length
    ? `${all.length}개 중 ${tried.length}개 먹어 봤어` + (tried.length ? ` · 평균 ★${avg.toFixed(1)}` : '')
    : '먹고 싶은 메뉴랑 레시피 링크를 모아 두자';

  // 정렬/필터: 최신순 | ★ 높은 순 (안 먹어 본 건 맨 아래) | 안 먹어 본 것만
  document.querySelectorAll('#rcFilter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === rc.sort)));
  $('rcFilter').hidden = !all.length;
  let items = all;
  if (rc.sort === 'star') items = [...all].sort((a, b) => (b.stars || 0) - (a.stars || 0));   // 안정 정렬이라 같은 별이면 최신 순
  if (rc.sort === 'todo') items = all.filter((x) => !x.stars);

  if (!items.length) {
    const li = document.createElement('li'); li.className = 'empty-row';
    li.textContent = all.length ? '다 먹어 봤어! 🎉 새 메뉴를 적어 볼까?' : '먹고 싶은 걸 첫 번째로 적어 봐 🍳';
    list.appendChild(li);
    return;
  }
  items.forEach((it) => {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who ' + (it.by || '');
    who.textContent = it.by === 'bear' ? '🐻' : it.by === 'bunny' ? '🐰' : '♥';
    who.title = it.by === 'bear' ? '곰돌찡이 추가' : it.by === 'bunny' ? '토끼찡이 추가' : '';

    const main = document.createElement('div'); main.className = 'rc-main';
    const tools = document.createElement('div'); tools.className = 'rc-tools';

    if (rc.editId === it.id) {
      const form = document.createElement('form'); form.className = 'rc-edit';
      const n = document.createElement('input'); n.value = it.name; n.maxLength = 40; n.setAttribute('aria-label', '메뉴 이름 수정');
      const u = document.createElement('input'); u.value = it.url || ''; u.placeholder = '레시피 링크'; u.inputMode = 'url';
      u.autocapitalize = 'off'; u.spellcheck = false; u.setAttribute('aria-label', '레시피 링크 수정');
      const save = () => {
        const name = n.value.trim(), url = cleanUrl(u.value);
        if (!name) { n.focus(); return; }
        if (url === null) { $('rcMsg').textContent = '링크는 https:// 로 시작하는 주소만 넣을 수 있어'; u.focus(); return; }
        $('rcMsg').textContent = '';
        rc.editId = null;
        rcMutate((cur) => cur.map((x) => x.id === it.id ? { ...x, name, url } : x));
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      // 입력칸이 2개라 Enter로 form 제출이 안 돼서 직접 처리
      [n, u].forEach((el) => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { rc.editId = null; renderRecipes(); }
      }));
      const sv = document.createElement('button'); sv.type = 'submit'; sv.className = 'tool'; sv.textContent = '✓';
      sv.setAttribute('aria-label', '저장'); sv.style.opacity = '1';
      form.append(n, u);
      main.appendChild(form);
      sv.addEventListener('click', (e) => { e.preventDefault(); save(); });
      tools.appendChild(sv);
      setTimeout(() => n.focus(), 0);
    } else {
      const safe = cleanUrl(it.url);   // 저장된 값도 한 번 더 검사
      let name;
      if (safe) {
        name = document.createElement('a'); name.href = safe; name.target = '_blank'; name.rel = 'noopener noreferrer';
      } else {
        name = document.createElement('span');
      }
      name.className = 'rc-name'; name.textContent = it.name;
      const meta = document.createElement('div'); meta.className = 'rc-meta';
      meta.appendChild(starButtons(it));
      if (!it.stars) { const none = document.createElement('span'); none.className = 'rc-none'; none.textContent = '아직 안 먹어 봄'; meta.appendChild(none); }
      if (safe) { const src = document.createElement('span'); src.className = 'rc-src'; src.textContent = srcLabel(safe); meta.appendChild(src); }
      main.append(name, meta);
      main.appendChild(noteView(it));

      const ed = document.createElement('button'); ed.className = 'tool'; ed.type = 'button';
      ed.setAttribute('aria-label', '수정'); ed.textContent = '✎';
      ed.onclick = () => { rc.editId = it.id; rc.noteId = null; renderRecipes(); };
      const del = document.createElement('button'); del.className = 'tool'; del.type = 'button';
      del.setAttribute('aria-label', '삭제'); del.textContent = '✕';
      del.onclick = () => { if (confirm(`"${it.name}" 레시피 지울까?`)) rcMutate((cur) => cur.filter((x) => x.id !== it.id)); };
      tools.append(ed, del);
    }
    li.append(who, main, tools);
    list.appendChild(li);
  });
}

// 한 줄 후기: 🐻/🐰 각자 하나씩. 먹어 본(별 1개 이상) 메뉴에만, 내 후기만 수정 가능.
// 저장 형태: notes: { bear: '...', bunny: '...' }  (예전 note/noteBy 한 개짜리도 읽어 줌)
const NOTE_WHO = ['bear', 'bunny'];
function notesOf(it) {
  const n = { ...(it.notes || {}) };
  if (it.note && !it.notes) n[NOTE_WHO.includes(it.noteBy) ? it.noteBy : 'legacy'] = it.note;
  return n;
}
function withNote(x, who, text) {
  const notes = notesOf(x);
  if (text) notes[who] = text; else delete notes[who];
  const { note, noteBy, ...rest } = x;   // 예전 형식 필드는 정리
  return { ...rest, notes };
}

function noteView(it) {
  const box = document.createElement('div');
  box.className = 'rc-notes';
  const notes = notesOf(it), me = getMe();
  const order = ['legacy', ...NOTE_WHO];
  order.forEach((who) => {
    const text = notes[who] || '';
    const editing = rc.noteId === `${it.id}:${who}`;
    const mine = who === me || (who === 'legacy' && !!me);
    if (editing) { box.appendChild(noteInput(it, who, text)); return; }
    if (text) {
      const icon = who === 'bear' ? '🐻' : who === 'bunny' ? '🐰' : '💬';
      const el = document.createElement(mine ? 'button' : 'div');
      el.className = 'rc-note ' + who + (mine ? ' mine' : '');
      el.textContent = `${icon} “${text}”`;
      if (mine) {
        el.type = 'button';
        el.setAttribute('aria-label', `내 한 줄 후기: ${text} (눌러서 수정)`);
        el.onclick = () => openNote(it, who);
      }
      box.appendChild(el);
    }
  });
  // 내 후기가 아직 없으면 "쓰기" 버튼 (안 먹어 본 메뉴엔 없음)
  if (it.stars && !(me && notes[me]) && !rc.noteId?.startsWith(it.id + ':')) {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'rc-note add';
    add.textContent = me ? `${me === 'bear' ? '🐻' : '🐰'} 내 한 줄 후기 쓰기` : '💬 한 줄 후기 쓰기';
    add.onclick = () => {
      if (!getMe()) { $('rcMsg').textContent = '⚙️ 설정에서 "나는 누구?"를 먼저 골라 줘'; return; }
      openNote(it, getMe());
    };
    box.appendChild(add);
  }
  return box;
}
function openNote(it, who) { rc.noteId = `${it.id}:${who}`; rc.editId = null; $('rcMsg').textContent = ''; renderRecipes(); }

function noteInput(it, who, text) {
  const inp = document.createElement('input');
  inp.className = 'rc-note-in'; inp.maxLength = 60; inp.value = text;
  inp.placeholder = '어땠어? 한 줄로 남겨 줘';
  inp.setAttribute('aria-label', `${it.name} 내 한 줄 후기`);
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    rc.noteId = null;
    const v = inp.value.trim();
    if (save && v !== text) rcMutate((cur) => cur.map((x) => x.id === it.id ? withNote(x, who, v) : x));
    else renderRecipes();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  setTimeout(() => inp.focus(), 0);
  return inp;
}

if ($('rcFilter')) {
  $('rcFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    rc.sort = b.dataset.f;
    try { localStorage.setItem(RC_SORT_KEY, rc.sort); } catch {}
    renderRecipes();
  });
}

if ($('rcForm')) {
  // 공유 문구("[만개의레시피] 김치찌개 https://...")를 링크 칸에 붙여 넣으면 메뉴 이름도 채워 줌
  $('rcUrl').addEventListener('paste', () => setTimeout(() => {
    const raw = $('rcUrl').value, url = cleanUrl(raw);
    if (!url) return;
    const m = raw.match(/https?:\/\/[^\s<>"'`]+/i);
    const rest = m ? raw.replace(m[0], '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim() : '';
    $('rcUrl').value = url;
    if (rest && !$('rcName').value.trim()) $('rcName').value = rest.slice(0, 40);
  }, 0));
  $('rcForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('rcName').value.trim(), url = cleanUrl($('rcUrl').value), msg = $('rcMsg');
    if (!name) { msg.textContent = '먹고 싶은 메뉴 이름을 적어 줘'; $('rcName').focus(); return; }
    if (url === null) { msg.textContent = '링크는 https:// 로 시작하는 주소만 넣을 수 있어'; $('rcUrl').focus(); return; }
    if (!rc.store) return;
    msg.textContent = '';
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, url, stars: 0, by: getMe() || '', at: Date.now() };
    $('rcName').value = ''; $('rcUrl').value = '';
    rcMutate((cur) => [...cur, item]);
  });
}

/* ====================== 이모티콘 (간단 의사소통) ====================== */
// 하트 버튼 → 이모티콘 누르면 상대방에게 전달.
// 상대가 페이지를 열어 두고 있으면 바로, 아니면 다음에 열 때 뜸 (푸시 알림은 서버가 필요해서 아직 X)
// 저장: couples/{sha256(docId + ':emoticon')} = 암호화된 { msgs: [...최근 40개], seen: { bear, bunny } }
const EMO_DIR = 'assets/emoticon/';
const EMO_PER_PAGE = 12;   // 이모티콘 창 한 장에 4×3
const EMO_MAX = 40;                       // 최근 40개만 보관
const EMO_FRESH_MS = 3 * 86400000;        // 3일 넘은 건 받아도 안 띄움
const EMO_SEEN_KEY = 'couple-emo-seen', EMO_SENT_KEY = 'couple-emo-sent';
const WHO = { bear: { name: '곰돌찡', icon: '🐻' }, bunny: { name: '토끼찡', icon: '🐰' } };
const partnerOf = (me) => (me === 'bear' ? 'bunny' : me === 'bunny' ? 'bear' : null);
const emo = { list: [], store: null, data: { msgs: [], seen: {} }, queue: [], lastSend: 0, toastT: 0 };

const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const normEmo = (v) => (v && !Array.isArray(v) && Array.isArray(v.msgs) ? { msgs: v.msgs, seen: v.seen || {} } : { msgs: [], seen: {} });
const emoLabel = (file) => (emo.list.find((x) => x.file === file) || {}).label || '';
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function emoImg(file, alt = '') {
  const im = document.createElement('img');
  im.src = EMO_DIR + encodeURIComponent(file); im.alt = alt; im.decoding = 'async';
  return im;
}

async function initEmoticon() {
  try {
    const r = await fetch(EMO_DIR + 'list.json', { cache: 'no-cache' });
    emo.list = r.ok ? await r.json() : [];
  } catch { emo.list = []; }
  if (!emo.list.length) return;
  $('emoFab').hidden = false;
  emo.list.forEach((x) => { const i = new Image(); i.src = EMO_DIR + encodeURIComponent(x.file); });   // 미리 받아 두기
  renderEmoPop();
  // 오류 메시지는 토스트로만 (status 칸 대신)
  const statusSink = { set textContent(v) { if (v && v.startsWith('⚠️')) emoToast(v); } };
  emo.store = await openStore(await sha256hex(state.docId + ':emoticon'), 'couple-emo-local', statusSink, '이모티콘');
  emo.store.subscribe((v) => { emo.data = normEmo(v); onEmoData(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onEmoData(); });
  watchFooter();
}

// 받은 것 중 아직 확인 안 한 것 찾기
function onEmoData() {
  const me = getMe();
  const seen = Math.max(lsGet(EMO_SEEN_KEY, 0), (me && emo.data.seen[me]) || 0);
  const sent = lsGet(EMO_SENT_KEY, []);
  const fresh = Date.now() - EMO_FRESH_MS;
  emo.queue = emo.data.msgs.filter((m) =>
    m.at > seen && m.at > fresh && (me ? m.from !== me : !sent.includes(m.id)));
  const unread = emo.queue.length > 0;
  $('emoDot').hidden = !unread;
  $('emoFab').classList.toggle('unread', unread);
  if (!$('emoPop').hidden) renderEmoPop();
  if (unread && !document.hidden) showRecv();
  else if (!unread) $('emoRecv').hidden = true;
}

function showRecv() {
  const q = emo.queue, m = q[q.length - 1];   // 가장 최근 것을 크게
  const who = WHO[m.from];
  $('emoFrom').textContent = who ? `${who.icon} ${who.name}이 보냈어 · ${ago(m.at)}` : `♥ 도착했어 · ${ago(m.at)}`;
  const img = $('emoImg');
  img.src = EMO_DIR + encodeURIComponent(m.e); img.alt = emoLabel(m.e);
  const more = $('emoMore'); more.innerHTML = '';
  if (q.length > 1) {
    more.append('그 전에 ');
    q.slice(0, -1).slice(-5).forEach((x) => more.appendChild(emoImg(x.e, emoLabel(x.e))));
    if (q.length - 1 > 5) more.append(` +${q.length - 6}`);
  }
  const wasHidden = $('emoRecv').hidden;
  $('emoRecv').hidden = false;
  if (wasHidden) { try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch {} $('emoOk').focus(); }
}

async function ackRecv() {
  const q = emo.queue;
  $('emoRecv').hidden = true;
  if (!q.length) return;
  const last = Math.max(...q.map((m) => m.at));
  lsSet(EMO_SEEN_KEY, Math.max(lsGet(EMO_SEEN_KEY, 0), last));
  emo.queue = [];
  $('emoDot').hidden = true; $('emoFab').classList.remove('unread');
  const me = getMe();
  if (me && emo.store) {   // 읽음 표시 (상대 화면에 "읽음 ✓")
    try { await emo.store.mutate((d) => { d = normEmo(d); d.seen = { ...d.seen, [me]: Math.max(d.seen[me] || 0, last) }; return d; }); }
    catch (e) { console.error(e); }
  }
}

function renderEmoPop() {
  const me = getMe(), to = partnerOf(me);
  $('emoTo').textContent = to ? `${WHO[to].icon} ${WHO[to].name}한테 보내기` : '이모티콘 보내기';
  $('emoMe').hidden = !!me;
  const grid = $('emoGrid');
  const keepX = grid.scrollLeft;   // 열려 있는 동안 다시 그려도 보던 페이지 그대로
  grid.innerHTML = '';
  // 12개(4×3) 넘으면 페이지로 나눠서 옆으로 넘기기
  const paged = emo.list.length > EMO_PER_PAGE;
  grid.classList.toggle('paged', paged);
  let page = grid;
  emo.list.forEach((x, i) => {
    if (paged && i % EMO_PER_PAGE === 0) { page = document.createElement('div'); page.className = 'emo-page'; grid.appendChild(page); }
    const b = document.createElement('button');
    b.type = 'button'; b.disabled = !me; b.title = x.label;
    b.setAttribute('aria-label', `${x.label} 보내기`);
    b.appendChild(emoImg(x.file));
    b.addEventListener('click', () => sendEmo(x.file));
    page.appendChild(b);
  });
  const dots = $('emoDots'); dots.innerHTML = '';
  dots.hidden = !paged;
  if (paged) {
    const n = Math.ceil(emo.list.length / EMO_PER_PAGE);
    for (let p = 0; p < n; p++) {
      const d = document.createElement('button'); d.type = 'button';
      d.setAttribute('aria-label', `${p + 1}번째 페이지`);
      d.addEventListener('click', () => grid.scrollTo({ left: p * grid.clientWidth, behavior: 'smooth' }));
      dots.appendChild(d);
    }
    grid.scrollLeft = keepX;
    emoSyncDots();
  }
  // 최근 주고받은 것 (최신 6개)
  const log = $('emoLog'); log.innerHTML = '';
  emo.data.msgs.slice(-6).reverse().forEach((m) => {
    const li = document.createElement('li');
    const mine = me ? m.from === me : lsGet(EMO_SENT_KEY, []).includes(m.id);
    const t = document.createElement('span'); t.className = 'lt';
    t.textContent = `${(WHO[m.from] || {}).icon || '♥'} ${mine ? '내가' : (WHO[m.from] || {}).name || ''} · ${emoLabel(m.e)}`;
    const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = ago(m.at);
    li.append(emoImg(m.e), t);
    if (mine && to && (emo.data.seen[to] || 0) >= m.at) {
      const rd = document.createElement('span'); rd.className = 'rd'; rd.textContent = '읽음 ✓'; li.appendChild(rd);
    }
    li.appendChild(tm);
    log.appendChild(li);
  });
}

// 지금 보는 페이지 점 표시
function emoSyncDots() {
  const grid = $('emoGrid'), w = grid.clientWidth;
  const cur = w ? Math.round(grid.scrollLeft / w) : 0;
  [...$('emoDots').children].forEach((d, i) => d.setAttribute('aria-current', String(i === cur)));
}
if ($('emoGrid')) $('emoGrid').addEventListener('scroll', () => requestAnimationFrame(emoSyncDots), { passive: true });

function toggleEmoPop(open) {
  const pop = $('emoPop');
  open = open ?? pop.hidden;
  if (open) { renderEmoPop(); $('emoToast').hidden = true; }
  pop.hidden = !open;
  if (open) emoSyncDots();   // 보이고 나서야 폭을 알 수 있어
  $('emoFab').setAttribute('aria-expanded', String(open));
}

function emoToast(text, file) {
  const el = $('emoToast');
  el.innerHTML = '';
  if (file) { const i = emoImg(file); i.style.cssText = 'width:24px;height:24px;vertical-align:-6px;margin-right:4px'; el.appendChild(i); }
  el.append(text);
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(emo.toastT);
  emo.toastT = setTimeout(() => { el.hidden = true; }, 2200);
}

async function sendEmo(file) {
  const me = getMe(), to = partnerOf(me);
  if (!me || !emo.store) return;
  if (Date.now() - emo.lastSend < 700) return;   // 연타 방지
  emo.lastSend = Date.now();
  const m = { id: hex(crypto.getRandomValues(new Uint8Array(8))), e: file, from: me, at: Date.now() };
  lsSet(EMO_SENT_KEY, [...lsGet(EMO_SENT_KEY, []), m.id].slice(-60));
  toggleEmoPop(false);
  emoToast(`${WHO[to].name}한테 "${emoLabel(file)}" 보냈어!`, file);
  try {
    await emo.store.mutate((d) => { d = normEmo(d); d.msgs = [...d.msgs, m].slice(-EMO_MAX); return d; });
    notifyPartner('emo', { label: emoLabel(file) });
  } catch (e) {
    console.error(e);
    emoToast('⚠️ 못 보냈어. 인터넷 연결을 확인해 줘.');
  }
}

// 맨 아래 footer가 보이면 하트 버튼을 그 위로 올리기 (겹치지 않게)
function watchFooter() {
  const f = document.querySelector('footer'), fab = $('emoFab');
  if (!f || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([en]) => {
    fab.style.bottom = en.isIntersecting ? `calc(${Math.round(f.offsetHeight) + 26}px + env(safe-area-inset-bottom,0px))` : '';
    $('emoPop').style.bottom = en.isIntersecting ? `calc(${Math.round(f.offsetHeight) + 98}px + env(safe-area-inset-bottom,0px))` : '';
  }, { root: $('scroller'), threshold: 0.01 }).observe(f);
}

$('emoFab').addEventListener('click', () => toggleEmoPop());
$('emoClose').addEventListener('click', () => toggleEmoPop(false));
$('emoOk').addEventListener('click', ackRecv);
$('emoReply').addEventListener('click', async () => { await ackRecv(); toggleEmoPop(true); });
$('emoMe').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setTimeout(() => { renderEmoPop(); onEmoData(); }, 0)));
document.addEventListener('click', (e) => {   // 바깥 누르면 닫기
  const pop = $('emoPop');
  if (pop.hidden || !e.target.isConnected) return;   // 다시 그려져서 사라진 버튼 클릭은 무시
  if (!pop.contains(e.target) && !$('emoFab').contains(e.target) && !$('emoRecv').contains(e.target)) toggleEmoPop(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('emoRecv').hidden) ackRecv(); else if (!$('emoPop').hidden) toggleEmoPop(false);
});

/* ====================== 스냅: 긴 섹션의 끝에도 멈출 자리 ====================== */
document.querySelectorAll('.scene').forEach((s) => {
  const a = document.createElement('div');
  a.className = 'snap-end'; a.setAttribute('aria-hidden', 'true');
  s.appendChild(a);
});

/* ====================== 섹션 바로 가기 (오른쪽 점 슬라이더) ====================== */
// .scene[data-nav="이름"] 이 있는 섹션마다 점이 하나씩 자동으로 생겨 (새 섹션도 data-nav만 붙이면 됨)
// 점 누르기 → 그 섹션으로 / 점 위를 위아래로 끌기 → 이름 보면서 빠르게 이동
const nav = { secs: [], btns: [], cur: -1, idleT: 0, labelT: 0, drag: null, raf: 0, inited: false };

// 지금 보이는 섹션(숨긴 메뉴 빼고, 화면 순서대로)마다 점 하나
function buildDots() {
  const rail = $('dotRail');
  rail.innerHTML = '';
  nav.cur = -1;
  nav.secs = [...document.querySelectorAll('.scene[data-nav]')].filter((s) => !s.hidden);
  nav.btns = nav.secs.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', `${s.dataset.nav}(으)로 가기`);
    b.appendChild(document.createElement('i'));
    b.addEventListener('click', (e) => { if (e.detail === 0) goToSection(i, 'smooth'); });   // 키보드(Enter)용
    rail.appendChild(b);
    return b;
  });
  syncDotNav();
}

function initDotNav() {
  const rail = $('dotRail');
  if (!rail || nav.inited) return;
  nav.inited = true;
  buildDots();
  $('dotnav').hidden = false;

  rail.addEventListener('pointerdown', (e) => {
    try { rail.setPointerCapture(e.pointerId); } catch {}
    const i = dotIndexAt(e.clientY);
    nav.drag = { y: e.clientY, moved: false, last: i };
    wakeNav(); showDotLabel(i);
  });
  rail.addEventListener('pointermove', (e) => {
    const d = nav.drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < 6) return;
    d.moved = true;
    const i = dotIndexAt(e.clientY);
    if (i !== d.last) {
      d.last = i;
      goToSection(i, 'auto');   // 끄는 중엔 즉시 이동 (빠른 스크롤)
      showDotLabel(i);
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
    }
  });
  const end = (e, cancel) => {
    const d = nav.drag;
    nav.drag = null;
    if (d && !d.moved && !cancel) goToSection(dotIndexAt(e.clientY), 'smooth');   // 그냥 톡 누르면 부드럽게
    hideDotLabelSoon();
  };
  rail.addEventListener('pointerup', (e) => end(e, false));
  rail.addEventListener('pointercancel', (e) => end(e, true));

  $('scroller').addEventListener('scroll', () => {
    if (nav.raf) return;
    nav.raf = requestAnimationFrame(() => { nav.raf = 0; syncDotNav(); wakeNav(); });
  }, { passive: true });
  syncDotNav();
  wakeNav();
}

function dotIndexAt(y) {
  let best = 0, bd = Infinity;
  nav.btns.forEach((b, i) => { const r = b.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - y); if (d < bd) { bd = d; best = i; } });
  return best;
}
function goToSection(i, behavior) {
  const s = nav.secs[i];
  if (!s) return;
  $('scroller').scrollTo({ top: s.offsetTop, behavior });
  setDotCurrent(i);
}
function setDotCurrent(i) {
  if (i === nav.cur) return;
  nav.cur = i;
  nav.btns.forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
}
// 지금 보고 있는 섹션: 화면 위쪽 35% 지점이 들어 있는 섹션 (맨 아래면 마지막)
function syncDotNav() {
  if (nav.drag && nav.drag.moved) return;
  const sc = $('scroller'), y = sc.scrollTop + sc.clientHeight * 0.35;
  let i = 0;
  nav.secs.forEach((s, k) => { if (s.offsetTop <= y) i = k; });
  if (sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2) i = nav.secs.length - 1;
  setDotCurrent(i);
}
function wakeNav() {
  const el = $('dotnav');
  el.classList.remove('idle');
  clearTimeout(nav.idleT);
  nav.idleT = setTimeout(() => { if (!nav.drag) el.classList.add('idle'); }, 1800);
}
function showDotLabel(i) {
  const lab = $('dotLabel'), b = nav.btns[i];
  if (!b) return;
  clearTimeout(nav.labelT);
  const r = b.getBoundingClientRect(), n = $('dotnav').getBoundingClientRect();
  lab.textContent = nav.secs[i].dataset.nav;
  lab.style.top = `${r.top + r.height / 2 - n.top}px`;
  lab.classList.add('show');
}
function hideDotLabelSoon() {
  clearTimeout(nav.labelT);
  nav.labelT = setTimeout(() => $('dotLabel').classList.remove('show'), 700);
}

/* ====================== 🧩 메뉴 고르기 (보이기 · 순서, 이 기기) ====================== */
// ⚙️ 설정에서 이 기기에 보일 메뉴랑 순서를 골라. localStorage 'couple-layout' = { order: [key…], hidden: [key…] }
// 섹션 key는 index.html 의 <section data-sec="…">. 새 섹션은 data-sec만 붙이면 기본 위치에 알아서 들어가.
// 숨긴 메뉴도 데이터는 계속 불러와 (예: 숨겨도 사진·질문 하면 키우기 간식은 쌓여)
const LAYOUT_KEY = 'couple-layout';
const SEC_INFO = {
  intro: '🎨 첫 화면 그림', gallery: '📷 갤러리', calendar: '📅 일정', bucket: '✅ 버킷리스트',
  recipe: '🍳 우리들의 레시피', pet: '🐶 같이 키우기', grape: '🍇 포도 심기', qna: '💬 서로 더 알아가기',
};
const secEls = (k) => [...document.querySelectorAll(`.scene[data-sec="${k}"]`)];
const DEFAULT_ORDER = [...new Set([...document.querySelectorAll('.scene[data-sec]')].map((s) => s.dataset.sec))];
const secLabel = (k) => SEC_INFO[k] || (secEls(k)[0] && secEls(k)[0].dataset.nav) || k;

function getLayout() {
  const raw = rawSet(lsRead(LAYOUT_KEY, {}));
  // 첫 화면 그림(intro)은 항상 맨 위라 순서에서 빼
  const order = (Array.isArray(raw.order) ? raw.order : []).filter((k, i, a) => k !== 'intro' && DEFAULT_ORDER.includes(k) && a.indexOf(k) === i);
  DEFAULT_ORDER.forEach((k, i) => { if (k !== 'intro' && !order.includes(k)) order.splice(Math.min(i - 1, order.length), 0, k); });   // 새로 생긴 메뉴
  const hidden = new Set((Array.isArray(raw.hidden) ? raw.hidden : []).filter((k) => DEFAULT_ORDER.includes(k)));
  if (order.every((k) => hidden.has(k))) hidden.delete(order[0]);   // 기능 메뉴는 최소 하나는 보이게
  return { order, hidden };
}
function applyLayout() {
  const { order, hidden } = getLayout(), main = $('scroller');
  ['intro', ...order].forEach((k) => secEls(k).forEach((s) => { main.appendChild(s); s.hidden = hidden.has(k); }));
  // 맨 아래 여백 + footer는 마지막으로 보이는 메뉴로
  main.querySelectorAll('.scene.last').forEach((s) => s.classList.remove('last'));
  const vis = [...main.querySelectorAll('.scene')].filter((s) => !s.hidden), last = vis[vis.length - 1];
  if (last) { last.classList.add('last'); const f = document.querySelector('footer'); if (f) last.appendChild(f); }
  if (nav.inited) { buildDots(); try { renderQna(); } catch {} }   // 점 슬라이더 다시 (알아가기 빨간 점 포함)
}
function saveLayout(order, hidden) {
  lsWrite(LAYOUT_KEY, { order, hidden: [...hidden] });
  applyLayout();
  renderLayoutSettings();
}
function renderLayoutSettings() {
  const box = $('setMenus');
  if (!box) return;
  const { order, hidden } = getLayout();
  const shown = order.filter((k) => !hidden.has(k)).length;
  box.innerHTML = '';
  const row = (k, i) => {
    const li = document.createElement('li');
    li.className = 'menu-row' + (hidden.has(k) ? ' off' : '');
    const lab = document.createElement('label'); lab.className = 'toggle';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !hidden.has(k);
    if (k !== 'intro' && !hidden.has(k) && shown <= 1) { cb.disabled = true; li.title = '메뉴는 하나 이상 보여야 해'; }
    cb.addEventListener('change', () => { const h = new Set(hidden); if (cb.checked) h.delete(k); else h.add(k); saveLayout(order, h); });
    lab.append(cb, secLabel(k));
    li.appendChild(lab);
    if (k !== 'intro') {
      const mv = (d, text, aria) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tool'; b.textContent = text;
        b.setAttribute('aria-label', `${secLabel(k)} ${aria}`);
        b.disabled = i + d < 0 || i + d >= order.length;
        b.addEventListener('click', () => {
          const o = [...order]; [o[i], o[i + d]] = [o[i + d], o[i]];
          saveLayout(o, hidden);
          const again = $('setMenus').querySelectorAll('.menu-row')[i + d + 1];   // 옮긴 줄에 포커스 유지
          if (again) { const t = again.querySelectorAll('.tool')[d < 0 ? 0 : 1]; if (t && !t.disabled) t.focus(); }
        });
        li.appendChild(b);
      };
      mv(-1, '▲', '위로'); mv(1, '▼', '아래로');
    } else {
      const s = document.createElement('span'); s.className = 'menu-fixed'; s.textContent = '맨 위 고정'; li.appendChild(s);
    }
    box.appendChild(li);
  };
  row('intro', -1);
  order.forEach(row);
}
if ($('setMenusReset')) $('setMenusReset').addEventListener('click', () => { lsWrite(LAYOUT_KEY, {}); applyLayout(); renderLayoutSettings(); });
applyLayout();

/* ====================== 서로 더 알아가기 (오늘의 질문) ====================== */
// 하루 한 질문: 그날 처음 연 사람이 정하고(공유 문서에 기록) 둘이 같은 질문을 봐.
// 내가 답해야 상대 답이 보여 (화면에서 가리는 것 — 데이터는 둘의 열쇠로 암호화돼 있음)
// 저장: couples/{sha256(docId + ':qna')} = 암호화된 { days: { 'YYYY-MM-DD': qid }, a: { qid: { bear: {...}, bunny: {...} } } }
//   답: 보기 질문 { c: 보기번호, n: 한마디, at } / 글 질문 { t: 글, at }
const Q_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const Q_ORDER = [...QUESTIONS].sort((a, b) => fnv(a.id + 'zz') - fnv(b.id + 'zz'));   // 분류가 골고루 섞이게
const qa = { store: null, data: { days: {}, a: {} }, view: null, editing: false, sel: null, archN: 10, ensuring: '' };
const normQa = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { days: v.days || {}, a: v.a || {} } : { days: {}, a: {} });

async function initQna() {
  if (!$('qaCard')) return;
  renderQna();
  qa.store = await openStore(await sha256hex(state.docId + ':qna'), 'couple-qna-local', $('qaStatus'), '질문');
  qa.store.subscribe((v) => {
    qa.data = normQa(v);
    petSeen('qa');
    if ($('qaCard').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // 입력 중이면 나중에
    renderQna();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderQna(); });
}

function pickNextQ(d, exclude = new Set()) {
  const used = new Set(Object.values(d.days));
  for (const q of Q_ORDER) {
    const a = d.a[q.id] || {};
    if (used.has(q.id) || exclude.has(q.id) || (a.bear && a.bunny)) continue;
    return q.id;
  }
  return null;   // 다 했으면 null
}
// 오늘 질문이 아직 안 정해졌으면 정하기 (둘이 동시에 열어도 transaction이라 하나로 정해짐)
function ensureToday() {
  const today = todayYmd();
  if (qa.data.days[today] || !qa.store || qa.ensuring === today) return;
  qa.ensuring = today;
  qa.store.mutate((cur) => {
    const d = normQa(cur);
    if (!d.days[today]) { const id = pickNextQ(d); if (id) d.days = { ...d.days, [today]: id }; }
    return d;
  }).catch((e) => { console.error(e); qa.ensuring = ''; });
}

function qaAnswerText(q, who, ans) {
  if (!ans) return '';
  if (!q.opts) return ans.t || '';
  let label = q.opts[ans.c] ?? '';
  if (q.who && (ans.c === 0 || ans.c === 1)) {   // 나/너 → 이름으로
    const target = ans.c === 0 ? who : partnerOf(who);
    label = target ? `${WHO[target].icon} ${WHO[target].name}` : label;
  }
  return label;
}
// 같은 답인지 (나/너 질문은 '누구'로 바꿔서 비교)
function qaSame(q, a1, w1, a2, w2) {
  if (!q.opts || !a1 || !a2) return null;
  const abs = (a, w) => (q.who && (a.c === 0 || a.c === 1) ? (a.c === 0 ? w : partnerOf(w)) : 'o' + a.c);
  return abs(a1, w1) === abs(a2, w2);
}

function qaAnsBox(q, who, ans, hidden) {
  const box = document.createElement('div');
  box.className = `qa-a ${who}` + (hidden ? ' hidden' : '');
  const b = document.createElement('b'); b.textContent = `${WHO[who].icon} ${WHO[who].name}`;
  box.appendChild(b);
  if (hidden) { box.append('답했어! 🔒 내가 답하면 보여'); return box; }
  box.append(qaAnswerText(q, who, ans));
  if (ans && ans.n) { const m = document.createElement('span'); m.className = 'memo'; m.textContent = ` · ${ans.n}`; box.appendChild(m); }
  return box;
}

function renderQna() {
  const card = $('qaCard');
  if (!card) return;
  const d = qa.data, me = getMe(), them = partnerOf(me), today = todayYmd();
  ensureToday();
  const todayId = d.days[today];
  if (qa.view && !Q_BY_ID.has(qa.view)) qa.view = null;
  const id = qa.view || todayId;
  const q = id && Q_BY_ID.get(id);
  card.innerHTML = '';

  // 통계 / 부제
  const both = Object.entries(d.a).filter(([k, v]) => Q_BY_ID.has(k) && v.bear && v.bunny);
  const choiceBoth = both.filter(([k]) => Q_BY_ID.get(k).opts);
  const same = choiceBoth.filter(([k, v]) => qaSame(Q_BY_ID.get(k), v.bear, 'bear', v.bunny, 'bunny')).length;
  $('qaSub').textContent = both.length
    ? `같이 답한 질문 ${both.length}개 · 통한 답 ${same}/${choiceBoth.length} 💞`
    : '매일 질문 하나! 둘 다 답하면 열려';

  if (!q) {
    const p = document.createElement('p'); p.className = 'qa-lock';
    p.textContent = qa.store ? (pickNextQ(d) ? '오늘의 질문 준비 중…' : '준비된 질문을 다 했어! 🎉 새 질문을 기다려 줘') : '불러오는 중…';
    card.appendChild(p);
  } else {
    const kind = id === todayId ? '오늘의 질문' : (them && d.a[id]?.[them] && !d.a[id]?.[me] ? `${WHO[them].icon}가 기다리는 질문` : '지난 질문');
    const top = document.createElement('div'); top.className = 'qa-top';
    const chip = document.createElement('span'); chip.className = 'qa-chip'; chip.textContent = q.catLabel;
    const k = document.createElement('span'); k.className = 'qa-kind'; k.textContent = kind;
    top.append(chip, k);
    if (id !== todayId && todayId) {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'qa-link'; back.textContent = '오늘 질문으로';
      back.style.marginLeft = 'auto';
      back.onclick = () => { qa.view = null; qa.editing = false; qa.sel = null; renderQna(); };
      top.appendChild(back);
    }
    const qq = document.createElement('p'); qq.className = 'qa-q'; qq.textContent = q.q;
    card.append(top, qq);

    if (!me) {
      const row = document.createElement('div'); row.className = 'qa-me';
      row.append('먼저, 나는');
      [['bear', '🐻 곰돌찡'], ['bunny', '🐰 토끼찡']].forEach(([w, t]) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
        b.onclick = () => { setMe(w); renderQna(); };
        row.appendChild(b);
      });
      card.appendChild(row);
    } else {
      const mine = d.a[id]?.[me], theirs = d.a[id]?.[them];
      if (!mine || qa.editing) {
        if (theirs && !mine) { const l = document.createElement('p'); l.className = 'qa-lock'; l.textContent = `${WHO[them].icon} ${WHO[them].name}은 벌써 답했어! 내가 답하면 열려 🔒`; card.appendChild(l); }
        card.appendChild(qaForm(q, id, me, mine));
      } else {
        const ans = document.createElement('div'); ans.className = 'qa-ans';
        const order = ['bear', 'bunny'];
        order.forEach((w) => {
          const a = d.a[id]?.[w];
          if (a) ans.appendChild(qaAnsBox(q, w, a, false));
        });
        card.appendChild(ans);
        if (theirs) {
          const s = qaSame(q, mine, me, theirs, them);
          if (s !== null) { const m = document.createElement('div'); m.className = 'qa-match'; m.textContent = s ? '통했다! 💞' : '달라! 서로 알아 가는 중 🤝'; card.appendChild(m); }
        } else {
          const w = document.createElement('p'); w.className = 'qa-lock'; w.textContent = `${WHO[them].icon} ${WHO[them].name} 답 기다리는 중…`; card.appendChild(w);
        }
        const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'qa-link'; ed.textContent = '내 답 바꾸기';
        ed.onclick = () => { qa.editing = true; qa.sel = mine.c ?? null; renderQna(); };
        card.appendChild(ed);
      }
    }
  }

  // 상대가 답하고 기다리는 질문들
  const pend = $('qaPending'); pend.innerHTML = '';
  const waiting = me && them ? Object.entries(d.a)
    .filter(([k, v]) => Q_BY_ID.has(k) && v[them] && !v[me] && k !== id)
    .sort((a, b) => (b[1][them].at || 0) - (a[1][them].at || 0)) : [];
  if (waiting.length) {
    const t = document.createElement('p'); t.textContent = `${WHO[them].icon} ${WHO[them].name}이 답하고 기다리는 질문 ${waiting.length}개`;
    pend.appendChild(t);
    waiting.slice(0, 5).forEach(([k]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `🔒 ${Q_BY_ID.get(k).q}`;
      b.onclick = () => { qa.view = k; qa.editing = false; qa.sel = null; renderQna(); };
      pend.appendChild(b);
    });
  }
  // 점 슬라이더 알림: 상대가 답했는데 내가 아직 안 한 게 있으면 빨간 점
  const needMe = !!(me && them && ((todayId && d.a[todayId]?.[them] && !d.a[todayId]?.[me]) || waiting.length));
  const ni = nav.secs.findIndex((s) => s.dataset.nav === '알아가기');
  if (ni >= 0 && nav.btns[ni]) nav.btns[ni].classList.toggle('has-new', needMe);

  renderQaArchive(both);
}

function qaForm(q, id, me, mine) {
  const wrap = document.createElement('div');
  let input;
  if (q.opts) {
    if (qa.sel === null && mine) qa.sel = mine.c;
    const opts = document.createElement('div'); opts.className = 'qa-opts'; opts.setAttribute('role', 'group');
    q.opts.forEach((o, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = o;
      b.setAttribute('aria-pressed', String(qa.sel === i));
      b.onclick = () => { qa.sel = i; opts.querySelectorAll('button').forEach((x, k) => x.setAttribute('aria-pressed', String(k === i))); go.disabled = false; };
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
  }
  const form = document.createElement('form'); form.className = 'qa-form';
  input = document.createElement('input');
  input.maxLength = q.opts ? 40 : 60;
  input.placeholder = q.opts ? '한마디 (안 써도 돼)' : '짧게 한 줄로';
  input.value = mine ? (q.opts ? (mine.n || '') : (mine.t || '')) : '';
  input.setAttribute('aria-label', q.opts ? '한마디' : '내 답');
  const go = document.createElement('button'); go.type = 'submit'; go.className = 'btn green'; go.textContent = '답하기';
  const ready = () => (q.opts ? qa.sel !== null : input.value.trim().length > 0);
  go.disabled = !ready();
  input.addEventListener('input', () => { go.disabled = !ready(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ready() || !qa.store) return;
    const v = input.value.trim();
    const ans = q.opts ? { c: qa.sel, ...(v ? { n: v } : {}), at: Date.now() } : { t: v, at: Date.now() };
    qa.editing = false; qa.sel = null;
    input.blur();
    qa.store.mutate((cur) => {
      const d = normQa(cur);
      d.a = { ...d.a, [id]: { ...(d.a[id] || {}), [me]: ans } };
      return d;
    }).then(() => { if (!mine) notifyPartner('qna'); }).catch((err) => { console.error(err); $('qaStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; });
  });
  form.append(input, go);
  wrap.appendChild(form);
  if (qa.editing) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'qa-link'; c.textContent = '취소';
    c.style.marginTop = '6px';
    c.onclick = () => { qa.editing = false; qa.sel = null; renderQna(); };
    wrap.appendChild(c);
  }
  return wrap;
}

function renderQaArchive(both) {
  const list = $('qaList'); list.innerHTML = '';
  const items = both.map(([k, v]) => ({ q: Q_BY_ID.get(k), v, at: Math.max(v.bear.at || 0, v.bunny.at || 0) }))
    .sort((a, b) => b.at - a.at);
  $('qaArchSum').textContent = items.length ? `지난 문답 보기 (${items.length})` : '지난 문답 보기';
  $('qaArchive').hidden = !items.length;
  items.slice(0, qa.archN).forEach(({ q, v }) => {
    const li = document.createElement('li');
    const chip = document.createElement('span'); chip.className = 'qa-chip'; chip.textContent = q.catLabel;
    const lq = document.createElement('p'); lq.className = 'lq'; lq.textContent = q.q;
    const ans = document.createElement('div'); ans.className = 'qa-ans';
    ans.append(qaAnsBox(q, 'bear', v.bear, false), qaAnsBox(q, 'bunny', v.bunny, false));
    li.append(chip, lq, ans);
    const s = qaSame(q, v.bear, 'bear', v.bunny, 'bunny');
    if (s !== null) { const m = document.createElement('span'); m.className = 'qa-match'; m.style.fontSize = '1rem'; m.textContent = s ? '통했다 💞' : '달라 🤝'; li.appendChild(m); }
    list.appendChild(li);
  });
  $('qaListMore').hidden = items.length <= qa.archN;
}

if ($('qaListMore')) {
  $('qaListMore').addEventListener('click', () => { qa.archN += 10; renderQna(); });
}

/* ====================== 같이 키우기 (다마고치) ====================== */
// 우리가 같이 한 일(사진·버킷리스트·레시피·질문)이 쌓이면 🦴 간식이 생기고, 간식을 주면 경험치가 올라서 자라.
// 간식은 따로 적립하지 않고 "지금 개수 − 데려온 날 개수"로 계산해 → 두 번 세거나, 체크했다 풀었다 해서 늘릴 수 없어.
// 저장: couples/{sha256(docId + ':pet')} = 암호화된 { kind, name, at, base, spent, exp, full, fedAt, log }
const PET_KINDS = {
  dog: { label: '강아지', icon: '🐶', ready: true },
  cat: { label: '고양이', icon: '🐱', ready: false },
  hamster: { label: '햄스터', icon: '🐹', ready: false },
};
const PET_EARN = [   // [키, 설명, 1개당 간식]
  ['photo', '📷 사진 올리기', 1],
  ['bucket', '✅ 버킷리스트 달성', 3],
  ['recipe', '🍳 레시피 먹어 보기 (별점 주기)', 2],
  ['qa', '💬 오늘의 질문 답하기 (각자)', 1],
  ['grape', '🍇 부탁 익히기 (고쳐진 부탁)', 3],
];
const PET_WELCOME = 3;      // 데려올 때 주는 간식
const PET_FEED_EXP = 10;    // 간식 1개 = 경험치 10
const PET_FEED_FULL = 25;   // 간식 1개 = 배부름 +25
const PET_DECAY = 4;        // 배부름은 1시간에 4씩 줄어 (하루쯤 지나면 배고파)
const PET_FULL_LIMIT = 90;  // 이만큼 배부르면 "이따 줘"
const pet = { store: null, data: null, loaded: false, ready: new Set(), pick: 'dog', busy: false, sayT: 0, lastPts: null };

const normPet = (v) => (v && typeof v === 'object' && !Array.isArray(v) && PET_KINDS[v.kind] ? v : null);
const petAllReady = () => PET_EARN.every(([k]) => pet.ready.has(k));
// 각 기능이 처음 불러와졌을 때 / 바뀔 때마다 불러 줘
function petSeen(k) { pet.ready.add(k); renderPet(); }
function petCounts() {
  return {
    photo: gal.cloud.length + gal.static.length,
    bucket: (Array.isArray(items) ? items : []).filter((x) => x && x.done).length,
    recipe: rc.items.filter((x) => x && x.stars > 0).length,
    qa: Object.values(qa.data.a || {}).reduce((n, v) => n + (v && v.bear ? 1 : 0) + (v && v.bunny ? 1 : 0), 0),
    grape: ripeCount(),
  };
}
const petPoints = (c) => PET_EARN.reduce((n, [k, , w]) => n + (Number(c && c[k]) || 0) * w, 0);
const petFood = (p, c = petCounts()) => Math.max(0, PET_WELCOME + petPoints(c) - petPoints(p.base) - (p.spent || 0));
const petFull = (p, now = Date.now()) => Math.max(0, Math.min(100, (p.full || 0) - ((now - (p.fedAt || p.at || now)) / 3600000) * PET_DECAY));
function petLevel(exp) {
  let lv = 1, need = 30, left = exp || 0;
  while (left >= need) { left -= need; lv++; need = 30 + (lv - 1) * 10; }
  return { lv, cur: left, need };
}
const petStage = (lv) => (lv >= 10 ? '어른' : lv >= 5 ? '꼬마' : '아기');
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
// 받침 있으면 a, 없으면 b (곰돌찡이 / 뭉치가)
const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xAC00; return c >= 0 && c <= 11171 && c % 28 ? a : b; };

async function initPet() {
  if (!$('petBox')) return;
  renderPet();
  pet.store = await openStore(await sha256hex(state.docId + ':pet'), 'couple-pet-local', $('petStatus'), '키우기');
  pet.store.subscribe((v) => { pet.data = normPet(v); pet.loaded = true; renderPet(); syncFarmPets(); renderFarm(); });
  setInterval(() => { if (!document.hidden) { renderPet(); syncFarmPets(); } }, 60000);   // 시간이 지나 배고파지는 것 반영
}
async function petMutate(fn) {
  try { await pet.store.mutate(fn); return true; }
  catch (e) { console.error(e); $('petStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; return false; }
}

function renderPet() {
  if (!$('petBox')) return;
  const p = pet.data;
  $('petAdopt').hidden = !pet.loaded || !!p;
  $('petHome').hidden = !p;
  if (!pet.loaded) { $('petSub').textContent = '불러오는 중…'; return; }
  if (!p) { renderPetAdopt(); return; }

  const c = petCounts(), food = petFood(p, c), full = petFull(p), L = petLevel(p.exp), kind = PET_KINDS[p.kind];
  $('petSub').textContent = `${kind.icon} Lv.${L.lv} ${petStage(L.lv)} ${kind.label} · 같이 키운 지 ${Math.floor((Date.now() - p.at) / 86400000) + 1}일`;
  $('petName').textContent = p.name;
  const stage = $('petStage');
  stage.dataset.stage = petStage(L.lv);
  stage.classList.toggle('hungry', full < 30);
  $('petFullBar').style.width = full + '%';
  $('petFullTxt').textContent = full < 30 ? `${Math.round(full)}% 배고파…` : `${Math.round(full)}%`;
  $('petExpBar').style.width = (L.cur / L.need) * 100 + '%';
  $('petExpTxt').textContent = `${L.cur}/${L.need}`;
  $('petFood').textContent = `${food}개`;
  $('petFeed').classList.toggle('dim', food < 1 || full >= PET_FULL_LIMIT);

  // 간식 얻는 법 (데려온 뒤로 몇 번 했는지)
  const earn = $('petEarn'); earn.innerHTML = '';
  PET_EARN.forEach(([k, label, w]) => {
    const li = document.createElement('li');
    const n = Math.max(0, (c[k] || 0) - ((p.base && p.base[k]) || 0));
    li.textContent = `${label} → 🦴 +${w}`;
    const s = document.createElement('span'); s.textContent = ` (${n}번)`; li.appendChild(s);
    earn.appendChild(li);
  });
  // 최근 돌본 기록
  const log = $('petLog'); log.innerHTML = '';
  (p.log || []).slice(-3).reverse().forEach((x) => {
    const li = document.createElement('li');
    const who = WHO[x.who];
    li.textContent = `${who ? `${who.icon} ${who.name}${josa(who.name, '이', '가')}` : '♥'}${x.t === 'adopt' ? ' 데려왔어 🏠' : ' 간식 줬어 🦴'} · ${ago(x.at)}`;
    log.appendChild(li);
  });

  // 새로 간식이 생기면 알려 주기
  const pts = petPoints(c);
  if (petAllReady()) {
    if (pet.lastPts !== null && pts > pet.lastPts) emoToast(`🦴 간식 +${pts - pet.lastPts}! ${p.name}한테 주러 가자`);
    pet.lastPts = pts;
  }
}

function renderPetAdopt() {
  $('petSub').textContent = '우리 둘이 같이 키울 친구를 데려와 봐 🐾';
  const box = $('petKinds'); box.innerHTML = '';
  Object.entries(PET_KINDS).forEach(([k, v]) => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'pet-kind'; b.disabled = !v.ready;
    b.setAttribute('aria-pressed', String(pet.pick === k));
    const big = document.createElement('span'); big.className = 'pk-icon'; big.textContent = v.icon;
    const t = document.createElement('span'); t.textContent = v.ready ? v.label : `${v.label} (준비 중)`;
    b.append(big, t);
    b.onclick = () => { pet.pick = k; renderPetAdopt(); };
    box.appendChild(b);
  });
  const ok = petAllReady();
  $('petAdoptBtn').disabled = !ok;
  $('petAdoptBtn').textContent = ok ? '데려오기' : '추억 불러오는 중…';
}

async function adoptPet() {
  const kind = pet.pick, name = ($('petNameIn').value.trim() || '뭉치').slice(0, 10);
  if (!PET_KINDS[kind].ready || !petAllReady() || pet.busy) return;
  pet.busy = true;
  const now = Date.now(), base = petCounts(), me = getMe() || '';
  await petMutate((cur) => normPet(cur) || {
    kind, name, at: now, base, spent: 0, exp: 0, full: 60, fedAt: now, log: [{ who: me, t: 'adopt', at: now }],
  });
  pet.busy = false;
  pet.lastPts = petPoints(base);
  setTimeout(() => petSay(`안녕! 나는 ${name}${josa(name, '이', '')}야 🐾`), 300);
}

async function feedPet() {
  const p = pet.data;
  if (!p || pet.busy) return;
  if (petFood(p) < 1) { petSay('간식이 없어… 같이 추억 쌓으면 생겨! 📷'); return; }
  if (petFull(p) >= PET_FULL_LIMIT) { petSay('배불러~ 이따 줘 😋'); petAnim('jump'); return; }
  pet.busy = true;
  const me = getMe() || '', now = Date.now(), before = petLevel(p.exp).lv;
  let fed = false;
  const saved = await petMutate((cur) => {
    const q = normPet(cur);
    fed = false;
    if (!q || petFood(q) < 1 || petFull(q, now) >= PET_FULL_LIMIT) return cur;
    fed = true;
    return {
      ...q, spent: (q.spent || 0) + 1, exp: (q.exp || 0) + PET_FEED_EXP,
      full: Math.min(100, petFull(q, now) + PET_FEED_FULL), fedAt: now,
      log: [...(q.log || []), { who: me, t: 'feed', at: now }].slice(-10),
    };
  });
  pet.busy = false;
  if (!saved || !fed) return;
  const after = petLevel((p.exp || 0) + PET_FEED_EXP).lv;
  petAnim('eat');
  if (after > before) { petSay(`레벨 업! Lv.${after} 🎉`); petHearts(8); }
  else { petSay(pickOne(['냠냠! 맛있어 🦴', '와구와구 😋', me ? `고마워 ${WHO[me].name}! 💕` : '고마워! 💕'])); petHearts(2); }
}

function patPet() {
  const p = pet.data;
  if (!p) return;
  petAnim('jump'); petHearts(3);
  const me = getMe();
  const hungry = petFull(p) < 30;
  petSay(hungry ? pickOne(['배고파… 🦴', '간식 없어…? 🥺', '꼬르륵…'])
    : pickOne(['멍멍! 🐾', '헤헤 좋아 💕', '또 쓰다듬어 줘!', me ? `${WHO[me].name} 최고! ✨` : '최고! ✨', '오늘도 같이 놀자!']));
}

function petSay(text) {
  const el = $('petSay');
  el.textContent = text; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(pet.sayT);
  pet.sayT = setTimeout(() => { el.hidden = true; }, 2600);
}
function petAnim(cls) {
  const el = $('petPet');
  el.classList.remove('jump', 'eat'); void el.offsetWidth; el.classList.add(cls);
}
function petHearts(n) {
  const stage = $('petStage');
  for (let i = 0; i < n; i++) {
    const h = document.createElement('span'); h.className = 'pet-heart'; h.textContent = pickOne(['💕', '♥', '✨']);
    h.style.left = `${40 + Math.random() * 20}%`;
    h.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    h.style.animationDelay = `${i * 70}ms`;
    stage.appendChild(h);
    setTimeout(() => h.remove(), 1400 + i * 70);
  }
}

if ($('petBox')) {
  $('petAdoptBtn').addEventListener('click', adoptPet);
  $('petFeed').addEventListener('click', feedPet);
  $('petPat').addEventListener('click', patPet);
  $('petPet').addEventListener('click', patPet);
  $('petRename').addEventListener('click', async () => {
    const p = pet.data; if (!p) return;
    const v = (prompt('새 이름 (10자까지)', p.name) || '').trim().slice(0, 10);
    if (v && v !== p.name) await petMutate((cur) => { const q = normPet(cur); return q ? { ...q, name: v } : cur; });
  });
}

/* ====================== 🍇 포도 심기 → 포도 만들기 탭 (칭찬 + 부탁) ====================== */
// 💜 칭찬 = 보라 포도알 (언제든, 제한 없이)
// 🌱 부탁 = 초록 포도알 (덜 익음). 고쳐야 하는 사람 송이에 바로 달려서 자리를 차지해.
//    받은 사람은 "💪 노력할게" / "🙋 고쳐봤어", 익히는 건 부탁한 사람만 ✨ → 그 자리에서 ⭐ 보라 포도로 익어
// 송이는 GRAPE_BUNCH알. 15자리가 다 차고 **전부 보라색**이어야 완성 = 🎟️ 소원권 1장
//    (초록이 남아 있으면 완성 안 됨 → 그 뒤 포도는 다음 송이에 대기)
// 부탁은 각자 진행 중인 게 GRAPE_ASK_MAX개까지 (한꺼번에 쌓이면 지치니까). 부탁은 알림 없이 조용히.
// 저장: couples/{sha256(docId + ':grape')} = 암호화된 { items: [{ id, kind:'praise'|'ask', from, to, text, at, state, ackAt, ripeAt }], wishes: [{ owner, n, usedAt, text }] }
const GRAPE_BUNCH = 15;
const GRAPE_ASK_MAX = 3;
const grape = { store: null, data: { items: [], wishes: [] }, loaded: false, view: null, kind: 'praise', sel: null, busy: false, shown: new Set() };
const normGrape = (v) => {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return { items: Array.isArray(o.items) ? o.items : [], wishes: Array.isArray(o.wishes) ? o.wishes : [] };
};
const grapeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isGrape = (it) => it.kind === 'praise' || (it.kind === 'ask' && it.state === 'ripe');   // 보라(익은) 포도
// 이 사람 송이 계산: 칭찬·부탁(초록 포함)을 생긴 순서대로 15알씩 나눠.
// 앞에서부터 "꽉 차고 전부 보라"인 송이만 완성으로 셈 → 초록이 익거나 거둬져야 그 송이가 완성돼
function bunchInfo(who, items = grape.data.items) {
  const seq = items.filter((it) => it.to === who && (it.kind === 'praise' || it.kind === 'ask')).sort((a, b) => a.at - b.at);
  const chunks = [];
  for (let i = 0; i < seq.length; i += GRAPE_BUNCH) chunks.push(seq.slice(i, i + GRAPE_BUNCH));
  let earned = 0;
  while (earned < chunks.length && chunks[earned].length === GRAPE_BUNCH && chunks[earned].every(isGrape)) earned++;
  const justDone = earned > 0 && earned === chunks.length;   // 방금 송이를 다 채움 (다음 포도 전)
  const cur = justDone ? chunks[earned - 1] : (chunks[earned] || []);
  const waiting = justDone ? 0 : seq.length - Math.min(seq.length, (earned + 1) * GRAPE_BUNCH);
  return { seq, earned, justDone, cur, waiting, purple: seq.filter(isGrape).length, green: cur.filter((it) => !isGrape(it)).length };
}
const ripeCount = () => grape.data.items.filter((it) => it.kind === 'ask' && it.state === 'ripe').length;

async function initGrape() {
  if (!$('grapeBox')) return;
  renderGrape();
  grape.store = await openStore(await sha256hex(state.docId + ':grape'), 'couple-grape-local', $('grapeStatus'), '포도밭');
  grape.store.subscribe((v) => {
    grape.data = normGrape(v); grape.loaded = true;
    petSeen('grape');
    if ($('grapeBox').contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;   // 쓰는 중이면 나중에
    renderGrape();
  });
}
async function grapeMutate(fn) {
  try { await grape.store.mutate((cur) => fn(normGrape(cur))); return true; }
  catch (e) { console.error(e); $('grapeStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; return false; }
}

function renderGrape() {
  if (!$('grapeBox')) return;
  const me = getMe(), them = partnerOf(me);
  if (!grape.view || !WHO[grape.view]) grape.view = me || 'bear';
  const who = grape.view, B = bunchInfo(who), inBunch = B.cur;

  // 누구 송이 볼지
  document.querySelectorAll('#grapeWho button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.who === who));
    b.querySelector('small').textContent = `${bunchInfo(b.dataset.who).purple}알`;
  });
  $('grapeSub').textContent = !grape.loaded ? '불러오는 중…'
    : B.justDone ? `${WHO[who].icon} ${WHO[who].name} 포도 · 🎉 ${B.earned}번째 송이 완성! 🎟️ 소원권이 생겼어 · 🌿 포도밭에 심을 수 있어`
    : `${WHO[who].icon} ${WHO[who].name} 포도 · 이번 송이 💜 ${inBunch.length - B.green}/${GRAPE_BUNCH}` +
      (B.green ? (inBunch.length === GRAPE_BUNCH ? ` · 🌱 ${B.green}알만 익으면 완성!` : ` · 🌱 ${B.green}알 익어가는 중`) : '') +
      (B.waiting ? ` · 다음 송이 ${B.waiting}알 대기` : '') + (B.earned ? ` · 완성 ${B.earned}송이 🍇` : '');
  drawBunch(inBunch);
  renderGrapeMsg();

  // 쓰기 (상대한테)
  const canWrite = !!me;
  $('grapeForm').hidden = !canWrite;
  $('grapeNoMe').hidden = canWrite;
  if (canWrite) {
    const myOpenAsks = grape.data.items.filter((it) => it.kind === 'ask' && it.from === me && it.state !== 'ripe').length;
    document.querySelectorAll('#grapeKind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === grape.kind)));
    const ta = $('grapeText'), full = grape.kind === 'ask' && myOpenAsks >= GRAPE_ASK_MAX;
    ta.placeholder = grape.kind === 'praise'
      ? `${WHO[them].name}한테 칭찬 한마디 💜 (예: 오늘 마중 나와줘서 고마웠어)`
      : `~할 때 ~해서 속상했어. ~해주면 좋겠어 🥺`;
    ta.disabled = full;
    $('grapeSend').disabled = full;
    $('grapeSend').textContent = grape.kind === 'praise' ? '💜 포도 달아주기' : '🌱 부탁 남기기';
    $('grapeHint').textContent = grape.kind === 'praise' ? `${WHO[them].icon} ${WHO[them].name} 송이에 보라 포도 한 알이 열려`
      : full ? `진행 중인 부탁이 ${GRAPE_ASK_MAX}개야. 하나가 익으면 또 쓸 수 있어 🌱`
      : `${WHO[them].icon} 송이에 초록 포도로 달려. 알림 없이 조용히, 익히는 건 나만 (지금 ${myOpenAsks}/${GRAPE_ASK_MAX})`;
  }
  renderAsks(me, them);
  renderWishes(me, them);
  renderFarm();   // 🌿 심을 송이 수 · 탭 빨간 점
}

// 포도송이 그림: 5·4·3·2·1 = 15알 (거꾸로 된 삼각형)
function drawBunch(inBunch) {
  const svg = $('grapeSvg'), NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); svg.appendChild(e); return e; };
  mk('path', { d: 'M100 30 C100 18 104 10 112 4', fill: 'none', stroke: '#7A5A3A', 'stroke-width': 5, 'stroke-linecap': 'round' });
  mk('path', { d: 'M104 22 C116 6 140 6 150 16 C138 30 116 32 104 22Z', fill: '#9ACB8F', stroke: '#1f1f1f', 'stroke-width': 3, 'stroke-linejoin': 'round' });
  mk('path', { d: 'M108 21 C120 16 132 14 142 15', fill: 'none', stroke: '#1f1f1f', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
  const rows = [5, 4, 3, 2, 1], R = 15, gapX = 31, gapY = 27;
  let k = 0;
  rows.forEach((n, r) => {
    for (let c = 0; c < n; c++) {
      const cx = 100 + (c - (n - 1) / 2) * gapX, cy = 48 + r * gapY, it = inBunch[k];
      const g = document.createElementNS(NS, 'g');
      const green = it && !isGrape(it);
      g.setAttribute('class', 'gp' + (it ? (green ? ' green' : it.kind === 'ask' ? ' ripe' : ' on') : ' empty') + (it && grape.sel === it.id ? ' sel' : '') + (it && !grape.shown.has(it.id) ? ' pop' : ''));
      if (it) grape.shown.add(it.id);   // 새로 열린 포도만 톡 튀어나오게
      g.innerHTML = it
        ? `<circle cx="${cx}" cy="${cy}" r="${R}"/><ellipse cx="${cx - 5}" cy="${cy - 6}" rx="4" ry="2.6" fill="#fff" opacity=".7"/>` +
          (green ? `<path d="M${cx} ${cy - R + 1} q4 -7 10 -6 q-2 6 -10 6z" fill="#7FB98A" stroke="#1f1f1f" stroke-width="1.4"/>` +
            (it.state === 'checking' ? `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12">🙋</text>` : '')
          : it.kind === 'ask' ? `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13">⭐</text>` : '')
        : `<circle cx="${cx}" cy="${cy}" r="${R}"/>`;
      if (it) {
        g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
        g.setAttribute('aria-label', `${green ? '익어가는 부탁' : it.kind === 'ask' ? '익은 부탁' : '칭찬'}: ${it.text}`);
        const pick = () => { grape.sel = grape.sel === it.id ? null : it.id; renderGrape(); };
        g.addEventListener('click', pick);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
      svg.appendChild(g);
      k++;
    }
  });
}
function renderGrapeMsg() {
  const box = $('grapeMsg'), it = grape.data.items.find((x) => x.id === grape.sel);
  box.innerHTML = '';
  if (!it) { box.textContent = '포도알을 누르면 무슨 말이었는지 보여 🍇'; box.className = 'grape-msg empty-msg'; return; }
  box.className = 'grape-msg';
  const head = document.createElement('b');
  const green = it.kind === 'ask' && !isGrape(it);
  head.textContent = green
    ? `🌱 익어가는 부탁 · ${WHO[it.from].icon} ${WHO[it.from].name}의 부탁`
    : it.kind === 'ask' ? `⭐ 고쳐서 익은 포도 · ${WHO[it.from].icon}의 부탁`
    : `💜 ${WHO[it.from].icon} ${WHO[it.from].name}의 칭찬`;
  const t = document.createElement('p'); t.textContent = it.text;
  const d = document.createElement('small');
  d.textContent = green
    ? `${prettyDate(ymd(new Date(it.at)))} · ${it.state === 'checking' ? '🙋 고쳐봤대! 확인 기다리는 중' : it.state === 'trying' ? '💪 노력하는 중' : '아직 덜 익었어'}`
    : prettyDate(ymd(new Date(it.kind === 'ask' ? it.ripeAt : it.at)));
  box.append(head, t, d);
}

function renderAsks(me, them) {
  const box = $('grapeAsks'), open = grape.data.items.filter((it) => it.kind === 'ask' && it.state !== 'ripe');
  $('grapeAskSum').textContent = `🌱 익어가는 부탁 ${open.length}개`;
  box.innerHTML = '';
  if (!open.length) { const p = document.createElement('p'); p.className = 'grape-empty'; p.textContent = '익어가는 부탁이 없어 🌿'; box.appendChild(p); return; }
  [['나한테 온 부탁', open.filter((it) => it.to === me)], ['내가 한 부탁', open.filter((it) => it.from === me)]].forEach(([title, arr]) => {
    if (!me || !arr.length) return;
    const h = document.createElement('p'); h.className = 'grape-h'; h.textContent = title; box.appendChild(h);
    arr.sort((a, b) => a.at - b.at).forEach((it) => {
      const li = document.createElement('div'); li.className = 'ask';
      const t = document.createElement('p'); t.className = 'ask-t'; t.textContent = it.text;
      const st = document.createElement('small'); st.className = 'ask-st';
      st.textContent = `${ago(it.at)} · ` + (it.state === 'checking' ? '🙋 고쳐봤대! 확인해 줘' : it.state === 'trying' ? '💪 노력하는 중' : '아직 못 봤을 수도');
      const row = document.createElement('div'); row.className = 'ask-btns';
      const btn = (text, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = text; b.onclick = fn; row.appendChild(b); };
      if (it.to === me) {
        if (it.state === 'open') btn('💪 노력할게', '', () => askState(it.id, 'trying'));
        if (it.state !== 'checking') btn('🙋 고쳐봤어', 'green', () => askState(it.id, 'checking'));
        else { const s = document.createElement('small'); s.textContent = `${WHO[them].name}${josa(WHO[them].name, '이', '가')} 확인하면 ⭐ 포도가 돼`; row.appendChild(s); }
      } else {
        btn('✨ 고쳐졌어! 익히기', 'green', () => ripenAsk(it.id));
        btn('거두기', 'ghost', () => { if (confirm('이 부탁을 거둘까? (지워져)')) grapeMutate((d) => ({ ...d, items: d.items.filter((x) => x.id !== it.id) })); });
      }
      li.append(t, st, row);
      box.appendChild(li);
    });
  });
}
function renderWishes(me, them) {
  const box = $('grapeWishes');
  box.innerHTML = '';
  BDAY_WHO.forEach(([w, icon, name]) => {
    const earned = bunchInfo(w).earned;
    const used = grape.data.wishes.filter((x) => x.owner === w);
    const left = Math.max(0, earned - used.length);
    const row = document.createElement('div'); row.className = 'wish-row';
    const t = document.createElement('span'); t.textContent = `${icon} ${name} 🎟️ ${left}장`;
    row.appendChild(t);
    if (w === me && left > 0) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn green'; b.textContent = '소원권 쓰기';
      b.onclick = () => useWish(me);
      row.appendChild(b);
    }
    box.appendChild(row);
    used.slice(-3).reverse().forEach((x) => {
      const u = document.createElement('p'); u.className = 'wish-used';
      u.textContent = `✔ "${x.text}" · ${ago(x.usedAt)}`;
      box.appendChild(u);
    });
  });
}

async function sendGrape() {
  const me = getMe(), them = partnerOf(me), text = $('grapeText').value.trim().slice(0, 120);
  if (!me || !text || grape.busy) return;
  const kind = grape.kind;
  grape.busy = true;
  let ok = false;
  const saved = await grapeMutate((d) => {
    ok = false;
    if (kind === 'ask' && d.items.filter((it) => it.kind === 'ask' && it.from === me && it.state !== 'ripe').length >= GRAPE_ASK_MAX) return d;
    ok = true;
    const it = { id: grapeId(), kind, from: me, to: them, text, at: Date.now() };
    if (kind === 'ask') it.state = 'open';
    return { ...d, items: [...d.items, it] };
  });
  grape.busy = false;
  if (!saved || !ok) return;
  $('grapeText').value = '';
  if (kind === 'praise') {
    grape.view = them;
    emoToast(`💜 ${WHO[them].name} 송이에 포도 한 알!`);
    notifyPartner('praise');
  } else { grape.view = them; emoToast(`🌱 ${WHO[them].name} 송이에 초록 포도로 조용히 달았어`); }
  renderGrape();
}
function askState(id, st) {
  return grapeMutate((d) => ({ ...d, items: d.items.map((x) => (x.id === id && x.kind === 'ask' && x.state !== 'ripe' && x.to === getMe() ? { ...x, state: st, ackAt: Date.now() } : x)) }));
}
async function ripenAsk(id) {
  const me = getMe();
  const it = grape.data.items.find((x) => x.id === id);
  if (!it || it.from !== me) return;   // 익히는 건 부탁한 사람만
  const ok = await grapeMutate((d) => ({ ...d, items: d.items.map((x) => (x.id === id && x.from === me && x.state !== 'ripe' ? { ...x, state: 'ripe', ripeAt: Date.now() } : x)) }));
  if (!ok) return;
  grape.view = it.to; grape.sel = id;
  emoToast(`⭐ ${WHO[it.to].name} 송이에 익은 포도 한 알! 고마워 💜`);
  notifyPartner('ripe');
  renderGrape();
}
async function useWish(me) {
  const text = (prompt('어떤 소원을 쓸까? (예: 설거지 면제, 데이트 코스 내가 정하기)') || '').trim().slice(0, 60);
  if (!text) return;
  const ok = await grapeMutate((d) => {
    const earned = bunchInfo(me, d.items).earned;
    if (d.wishes.filter((x) => x.owner === me).length >= earned) return d;
    return { ...d, wishes: [...d.wishes, { owner: me, n: earned, text, usedAt: Date.now() }] };
  });
  if (ok) { emoToast('🎟️ 소원권을 썼어!'); notifyPartner('wish', { label: text }); }
}

if ($('grapeBox')) {
  document.querySelectorAll('#grapeWho button').forEach((b) => b.addEventListener('click', () => { grape.view = b.dataset.who; grape.sel = null; renderGrape(); }));
  document.querySelectorAll('#grapeKind button').forEach((b) => b.addEventListener('click', () => { grape.kind = b.dataset.kind; renderGrape(); $('grapeText').focus(); }));
  $('grapeSend').addEventListener('click', sendGrape);
}

/* ====================== 🌿 포도밭 가꾸기 (완성한 송이 심기 + 펫 산책) ====================== */
// 송이를 다 채우면 🎟️ 소원권은 그대로 받고, 그 송이를 여기 심을 수도 있어 (송이 1개 = 포도나무 1그루)
// 심을 수 있는 수 = 완성 송이(bunchInfo.earned) − 이미 심은 수 → 두 번 심거나 부풀릴 수 없음
// 심는 건 송이 주인만. 밭은 둘이 같이 하나. 빈 자리를 눌러서 골라 심거나 🌱 심기 버튼(앞자리부터)
// 밭에선 지금 키우는 펫 + (나중에) 다 키워서 보낸 펫들이 돌아다녀. 밭이 화면에 보일 때만 움직여 (배터리)
// 저장: couples/{sha256(docId + ':vineyard')} = 암호화된 {
//   vines: [{ id, owner:'bear'|'bunny', n(그 사람 몇 번째 송이), slot(밭 자리), at }],
//   pets:  [{ id, kind, name, exp, at, retiredAt }]   ← 🐶 "포도밭으로 보내기"(은퇴)용 자리. 아직 넣는 기능은 없음
// }
const FW = 320, FCOLS = 5, FCELL = 60, FROW = 66, FTOP = 34;
const FARM_TAB_KEY = 'couple-grape-tab';
const FARM_PET_W = { 아기: 34, 꼬마: 40, 어른: 46 };   // 밭에서 펫 크기 (밭 너비 320 기준)
const farm = {
  store: null, data: { vines: [], pets: [] }, loaded: false, tab: 'make', sel: null, fresh: null, busy: false,
  walkers: [], sig: '', raf: 0, last: 0, visible: false, img: {},
};
try { if (localStorage.getItem(FARM_TAB_KEY) === 'farm') farm.tab = 'farm'; } catch {}
const frand = (a, b) => a + Math.random() * (b - a);
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const normFarm = (v) => {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {
    vines: (Array.isArray(o.vines) ? o.vines : []).filter((x) => x && WHO[x.owner] && Number.isInteger(x.slot) && x.slot >= 0),
    pets: (Array.isArray(o.pets) ? o.pets : []).filter((x) => x && PET_KINDS[x.kind]),
  };
};
const vinesOf = (who, d = farm.data) => d.vines.filter((v) => v.owner === who).length;
const plantable = (who, d = farm.data) => (grape.loaded && farm.loaded && WHO[who] ? Math.max(0, bunchInfo(who).earned - vinesOf(who, d)) : 0);

async function initFarm() {
  if (!$('grapeFarm')) return;
  setGrapeTab(farm.tab);
  farm.store = await openStore(await sha256hex(state.docId + ':vineyard'), 'couple-vine-local', $('farmStatus'), '포도밭');
  farm.store.subscribe((v) => { farm.data = normFarm(v); farm.loaded = true; renderFarm(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { farm.visible = es.some((e) => e.isIntersecting); farmKick(); }).observe($('farmField'));
  } else farm.visible = true;
  document.addEventListener('visibilitychange', farmKick);
  window.addEventListener('resize', farmPlace);
}
async function farmMutate(fn) {
  try { await farm.store.mutate((cur) => fn(normFarm(cur))); return true; }
  catch (e) { console.error(e); $('farmStatus').textContent = '⚠️ 저장하지 못했어. 잠시 후 다시 해 줘.'; return false; }
}

// 왼쪽 위 탭: 🍇 포도 만들기 / 🌿 포도밭 가꾸기 (이 기기에서 마지막 탭 기억)
function setGrapeTab(t) {
  farm.tab = t === 'farm' ? 'farm' : 'make';
  try { localStorage.setItem(FARM_TAB_KEY, farm.tab); } catch {}
  document.querySelectorAll('#grapeTabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === farm.tab)));
  $('grapeMake').hidden = farm.tab !== 'make';
  $('grapeFarm').hidden = farm.tab !== 'farm';
  renderFarm();
  farmKick();
}

// 밭 크기: 5칸씩 줄. 마지막으로 심은 줄 아래에 늘 빈 줄 하나 (최소 2줄)
function farmLayout() {
  const used = farm.data.vines.reduce((m, v) => Math.max(m, v.slot), -1);
  const rows = Math.max(2, Math.floor(used / FCOLS) + 2);
  return { rows, plots: rows * FCOLS, H: FTOP + rows * FROW + 8 };
}
const plotXY = (slot) => ({ x: 40 + (slot % FCOLS) * FCELL, y: FTOP + Math.floor(slot / FCOLS) * FROW + 54 });

function renderFarm() {
  if (!$('grapeFarm')) return;
  const me = getMe(), mine = plantable(me);
  $('farmDot').hidden = !(mine > 0);
  if (farm.tab !== 'farm') return;   // 안 보일 땐 탭의 빨간 점만
  const total = farm.data.vines.length;
  $('farmSub').textContent = !farm.loaded || !grape.loaded ? '불러오는 중…'
    : (total ? `🌿 포도나무 ${total}그루 (🐻 ${vinesOf('bear')} · 🐰 ${vinesOf('bunny')})` : '아직 심은 포도나무가 없어. 송이를 다 채우면 여기 심을 수 있어 🌱') +
      (pet.data ? ` · ${pet.data.name} 산책 중 🐾` : '');
  drawFarm(mine);
  renderFarmMsg();
  renderFarmPlant(me);
  syncFarmPets();
}

const vineSvg = (x, y, owner) => {
  const bunch = [[-5, 0], [0, 0], [5, 0], [-2.5, 4.5], [2.5, 4.5], [0, 9]]
    .map(([dx, dy]) => `<circle class="vb" cx="${x + 9 + dx}" cy="${y - 30 + dy}" r="3.4" fill="#8E6CC9" stroke="#1f1f1f" stroke-width="1.3"/>`).join('');
  return `<ellipse cx="${x}" cy="${y}" rx="15" ry="4.5" fill="#A87A52" stroke="#1f1f1f" stroke-width="1.3"/>` +
    `<path d="M${x} ${y} C${x - 5} ${y - 14} ${x + 5} ${y - 26} ${x} ${y - 40}" fill="none" stroke="#7A5A3A" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M${x} ${y - 36} q-14 -10 -20 2 q10 8 20 -2z" fill="#9ACB8F" stroke="#1f1f1f" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M${x} ${y - 40} q12 -12 20 0 q-10 8 -20 0z" fill="#9ACB8F" stroke="#1f1f1f" stroke-width="1.4" stroke-linejoin="round"/>` +
    bunch + `<text x="${x - 14}" y="${y - 4}" text-anchor="middle" font-size="9">${WHO[owner].icon}</text>`;
};
function drawFarm(mine) {
  const svg = $('farmSvg'), NS = 'http://www.w3.org/2000/svg', L = farmLayout();
  svg.setAttribute('viewBox', `0 0 ${FW} ${L.H}`);
  svg.innerHTML = '';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); svg.appendChild(e); return e; };
  // 하늘 · 해 · 울타리
  el('rect', { x: 0, y: 0, width: FW, height: FTOP, fill: '#EAF3FC' });
  el('circle', { cx: 292, cy: 13, r: 7, fill: '#FFD84D', stroke: '#1f1f1f', 'stroke-width': 2 });
  for (let x = 8; x < FW; x += 24) el('path', { d: `M${x} ${FTOP} V${FTOP - 15} l3.5 -4 l3.5 4 V${FTOP}`, fill: '#FFF6E8', stroke: '#1f1f1f', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
  el('path', { d: `M0 ${FTOP - 9} H${FW}`, stroke: '#1f1f1f', 'stroke-width': 1.5 });
  el('path', { d: `M0 ${FTOP} H${FW}`, stroke: '#1f1f1f', 'stroke-width': 2 });
  // 밭고랑
  for (let r = 0; r < L.rows; r++) {
    const y = FTOP + r * FROW + 54;
    el('rect', { x: 10, y: y - 6, width: FW - 20, height: 12, rx: 6, fill: '#D8B48C', stroke: '#1f1f1f', 'stroke-width': 1.4 });
  }
  const bySlot = new Map(farm.data.vines.map((v) => [v.slot, v]));
  for (let s = 0; s < L.plots; s++) {
    const { x, y } = plotXY(s), v = bySlot.get(s), g = el('g', {});
    const tap = (fn) => {
      g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.addEventListener('click', fn);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    };
    if (v) {
      g.setAttribute('class', 'vine' + (farm.sel === v.id ? ' sel' : '') + (farm.fresh === v.id ? ' pop' : ''));
      g.setAttribute('aria-label', `${WHO[v.owner].name}의 ${v.n}번째 송이`);
      g.innerHTML = vineSvg(x, y, v.owner);
      tap(() => { farm.sel = farm.sel === v.id ? null : v.id; farm.fresh = null; renderFarm(); });
    } else {
      const can = mine > 0 && !farm.busy;
      g.setAttribute('class', 'plot' + (can ? ' can' : ''));
      g.innerHTML = `<ellipse class="pm" cx="${x}" cy="${y}" rx="15" ry="4.5" fill="#C29068" stroke="#8a6a4a" stroke-width="1.2" stroke-dasharray="3 3"/>` +
        (can ? `<text class="pm" x="${x}" y="${y - 8}" text-anchor="middle" font-size="15" font-weight="700" fill="#4F8A45">+</text>` : '');
      if (can) { g.setAttribute('aria-label', `${s + 1}번 자리에 심기`); tap(() => plantVine(s)); }
    }
  }
}
function renderFarmMsg() {
  const box = $('farmMsg'), v = farm.data.vines.find((x) => x.id === farm.sel);
  box.innerHTML = '';
  if (!v) {
    box.className = 'grape-msg empty-msg';
    box.textContent = farm.data.vines.length ? '포도나무를 누르면 누구 송이였는지 보여 🍇'
      : pet.data ? `🐶 ${pet.data.name}${josa(pet.data.name, '을', '를')} 누르면 한마디 해` : '🐶 같이 키우기에서 데려온 친구가 여기서 산책해';
    return;
  }
  box.className = 'grape-msg';
  const seq = bunchInfo(v.owner).seq.slice((v.n - 1) * GRAPE_BUNCH, v.n * GRAPE_BUNCH);
  const praise = seq.filter((it) => it.kind === 'praise').length, ripe = seq.length - praise;
  const b = document.createElement('b'); b.textContent = `🍇 ${WHO[v.owner].icon} ${WHO[v.owner].name}의 ${v.n}번째 송이`;
  const p = document.createElement('p'); p.textContent = `💜 칭찬 ${praise}알` + (ripe ? ` · ⭐ 고친 부탁 ${ripe}알` : '');
  const d = document.createElement('small'); d.textContent = `${prettyDate(ymd(new Date(v.at)))}에 심었어`;
  box.append(b, p, d);
}
function renderFarmPlant(me) {
  const box = $('farmPlant');
  box.innerHTML = '';
  BDAY_WHO.forEach(([w, icon, name]) => {
    const n = plantable(w), row = document.createElement('div'); row.className = 'farm-row';
    const t = document.createElement('span'); t.textContent = `${icon} ${name} · 심은 나무 ${vinesOf(w)}그루` + (n ? ` · 🌱 심을 송이 ${n}개` : '');
    row.appendChild(t);
    if (w === me && n > 0) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn green'; b.textContent = '🌱 심기';
      b.disabled = farm.busy; b.onclick = () => plantVine();
      row.appendChild(b);
    }
    box.appendChild(row);
  });
  if (!me) { const p = document.createElement('p'); p.className = 'grape-nome'; p.textContent = '⚙️ 설정에서 "나는 누구?"를 고르면 내 송이를 심을 수 있어'; box.appendChild(p); }
}
async function plantVine(slot) {
  const me = getMe();
  if (!me || farm.busy || plantable(me) < 1) return;
  farm.busy = true;
  let placed = null;
  const ok = await farmMutate((d) => {
    placed = null;
    const n = vinesOf(me, d);
    if (n >= bunchInfo(me).earned) return d;   // 다른 기기에서 먼저 심었으면 그대로
    const taken = new Set(d.vines.map((v) => v.slot));
    let s = Number.isInteger(slot) && slot >= 0 && !taken.has(slot) ? slot : 0;
    while (taken.has(s)) s++;
    placed = { id: grapeId(), owner: me, n: n + 1, slot: s, at: Date.now() };
    return { ...d, vines: [...d.vines, placed] };
  });
  farm.busy = false;
  if (ok && placed) {
    farm.sel = placed.id; farm.fresh = placed.id;
    setTimeout(() => { if (farm.fresh === placed.id) farm.fresh = null; }, 900);
    emoToast(`🌱 ${WHO[me].name}의 ${placed.n}번째 송이를 심었어!`);
  }
  renderFarm();
}

/* --- 밭에서 돌아다니는 펫 --- */
function farmPetList() {
  const list = [];
  if (pet.data) list.push({ id: 'cur', cur: true, kind: pet.data.kind, name: pet.data.name, stage: petStage(petLevel(pet.data.exp).lv), hungry: petFull(pet.data) < 30 });
  farm.data.pets.forEach((p) => list.push({ id: p.id, cur: false, kind: p.kind, name: p.name, stage: petStage(petLevel(p.exp).lv), hungry: false }));
  return list;
}
// 키우기 화면의 SVG를 그림 한 장으로 (배고프면 시무룩한 얼굴). 고양이·햄스터 그림이 생기면 kind별로 나누기
function farmPetImg(kind, hungry) {
  const key = kind + (hungry ? ':h' : '');
  if (farm.img[key]) return farm.img[key];
  const src = document.querySelector('#petPet svg');
  if (!src) return '';
  const c = src.cloneNode(true);
  c.querySelectorAll(hungry ? '.dg-happy' : '.dg-sad').forEach((n) => n.remove());
  c.removeAttribute('class'); c.setAttribute('width', '200'); c.setAttribute('height', '214');
  return (farm.img[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c)));
}
function farmTarget(w) {
  const H = farmLayout().H;
  w.tx = frand(24, FW - 24); w.ty = frand(FTOP + 22, H - 6);
  w.speed = w.p.hungry ? 8 : frand(16, 26);
}
function syncFarmPets() {
  const layer = $('farmPets');
  if (!layer) return;
  const list = farmPetList();
  const sig = list.map((p) => `${p.id}:${p.kind}:${p.name}:${p.stage}:${p.hungry}`).join('|');
  if (sig === farm.sig) return;
  farm.sig = sig;
  const old = new Map(farm.walkers.map((w) => [w.id, w])), H = farmLayout().H;
  layer.innerHTML = '';
  farm.walkers = list.map((p) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'farm-pet'; el.setAttribute('aria-label', `${p.name} (누르면 한마디)`);
    el.style.width = `${((FARM_PET_W[p.stage] || 44) / FW) * 100}%`;
    el.innerHTML = '<div class="fp-in"><div class="fp-bob"><img alt=""></div><span class="fp-name"></span></div>';
    el.querySelector('img').src = farmPetImg(p.kind, p.hungry);
    el.querySelector('.fp-name').textContent = p.name;
    const prev = old.get(p.id);
    const w = prev ? Object.assign(prev, { p, el, img: el.querySelector('img') })
      : { id: p.id, p, el, img: el.querySelector('img'), x: frand(30, FW - 30), y: frand(FTOP + 24, H - 8), wait: frand(0, 2), face: 1 };
    if (!prev) farmTarget(w);
    el.addEventListener('click', () => farmPetSay(w));
    layer.appendChild(el);
    return w;
  });
  farmPlace(); farmKick();
}
function farmPetSay(w) {
  const lines = w.p.hungry ? ['배고파… 🦴', '간식 주러 와 줘 🥺']
    : w.p.cur ? ['포도 냄새 좋아 🍇', '여기 우리 밭이지? 🐾', '산책 최고 🌿', farm.data.vines.length ? `포도나무 ${farm.data.vines.length}그루!` : '나무 심어 줘 🌱']
    : ['여기 사는 게 좋아 🍇', '놀러 와 줘서 고마워 💜'];
  const old = w.el.querySelector('.fp-say');
  if (old) old.remove();
  const s = document.createElement('span'); s.className = 'fp-say'; s.textContent = pickOne(lines);
  w.el.querySelector('.fp-in').appendChild(s);
  w.wait = Math.max(w.wait, 1.8);
  clearTimeout(w.sayT); w.sayT = setTimeout(() => s.remove(), 2200);
  farmPlace();
}
function farmPlace() {
  const F = $('farmField');
  if (!F || !farm.walkers.length) return;
  const k = F.clientWidth / FW, H = farmLayout().H;
  if (!k) return;
  const still = reduceMotion();
  farm.walkers.forEach((w) => {
    w.y = Math.min(w.y, H - 4);
    w.el.style.transform = `translate(${w.x * k}px, ${w.y * k}px)`;
    w.el.style.zIndex = String(Math.round(w.y));
    w.img.style.transform = `scaleX(${w.face})`;
    w.el.classList.toggle('walking', !still && w.wait <= 0);
  });
}
const farmActive = () => farm.tab === 'farm' && farm.visible && !document.hidden && farm.walkers.length > 0 && !reduceMotion();
function farmKick() {
  if (farmActive() && !farm.raf) { farm.last = 0; farm.raf = requestAnimationFrame(farmTick); }
  else farmPlace();
}
function farmTick(t) {
  farm.raf = 0;
  if (!farmActive()) { farmPlace(); return; }
  const dt = farm.last ? Math.min(0.05, (t - farm.last) / 1000) : 0;
  farm.last = t;
  farm.walkers.forEach((w) => {
    if (w.wait > 0) { w.wait -= dt; return; }
    const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 1.5) { w.wait = frand(1, 3.5) * (w.p.hungry ? 2 : 1); farmTarget(w); return; }
    const s = Math.min(dist, w.speed * dt);
    w.x += (dx / dist) * s; w.y += (dy / dist) * s;
    if (Math.abs(dx) > 2) w.face = dx < 0 ? -1 : 1;
  });
  farmPlace();
  farm.raf = requestAnimationFrame(farmTick);
}

if ($('grapeFarm')) {
  document.querySelectorAll('#grapeTabs [role="tab"]').forEach((b) => b.addEventListener('click', () => setGrapeTab(b.dataset.tab)));
}

/* ====================== 🎮 놀이 (통나무 타기 · 공 받기) ====================== */
// 게임은 간식이 아니라 ⭐ 경험치만 줘 (게임만 돌려서 간식을 무한으로 못 모으게).
// 경험치는 게임마다 각자 하루 GAME_DAILY판까지만.
// 기록: 키우기 문서 games.{log|ball} = { best: {bear, bunny}, day, plays: {bear, bunny} }
// 새 게임 추가: games/ 에 클래스(start/pause/resume/stop/reset/draw/resize) 만들고 GAMES 에 한 줄 + index.html 버튼
const GAME_DAILY = 3;
const GAMES = {
  log: {
    title: '🪵 통나무 타기', Cls: LogGame, ctrl: 'gameCtrlLog',
    help: '앞으로 기울면 ◀ 뒤로, 뒤로 기울면 앞으로 ▶ 를 콕콕!',
    round: (v) => Math.round(v * 10) / 10, fmt: (v) => `${v.toFixed(1)}m`,
    exp: (m) => Math.min(10, Math.max(1, Math.round(m / 20))),   // 20m마다 ⭐1, 최대 10
    fail: '풍덩! 💦',
  },
  ball: {
    title: '⚾ 공 받기', Cls: BallGame, ctrl: 'gameCtrlBall',
    help: '줄어드는 동그라미가 점선에 딱 겹칠 때 콕! 5개 잡으면 자리가 바뀌고 10개면 움직여. ♥ 3개 다 잃으면 끝',
    round: (v) => Math.round(v), fmt: (v) => `${v}점`,
    exp: (s) => Math.min(10, Math.max(1, Math.round(s / 25))),   // 25점마다 ⭐1, 최대 10
    fail: '끝! 🐾',
  },
  run: {
    title: '🏃 허들 넘기', Cls: HurdleGame, ctrl: 'gameCtrlRun',
    help: '허들은 ⬆ 점프(길게 누르면 더 높이), 새는 ⬇ 숙이기! 보라색 높은 새는 그냥 달려. 부딪히면 끝',
    round: (v) => Math.floor(v), fmt: (v) => `${Math.floor(v)}m`,
    exp: (m) => Math.min(10, Math.max(1, Math.round(m / 80))),   // 80m마다 ⭐1, 최대 10
    fail: '꽈당! 🐶',
  },
  sort: {
    title: '🐻🐰 곰토 나누기', Cls: SortGame, ctrl: 'gameCtrlSort', load: sortAssets,
    help: '맨 아래 동그라미 친구가 토끼찡이면 ◀ 왼쪽, 곰돌찡이면 오른쪽 ▶! 20초·40초마다 표정이 늘어나. 틀리거나 빨간 선을 넘으면 ♥ 하나',
    round: (v) => Math.round(v), fmt: (v) => `${v}점`,
    exp: (s) => Math.min(10, Math.max(1, Math.round(s / 20))),   // 20점마다 ⭐1, 최대 10
    fail: '끝! 🐾',
  },
};
const gm = { key: null, game: null, imgs: null, playing: false };

// 🐻🐰 곰토 나누기 그림: 이모티콘 중 *_bear.png / *_rab.png (배경 = 사이트 배경 3컷 만화)
//   앞에서부터 차례로 등장: 0초 1개씩 → 20초 2개씩 → 40초 3개씩 (games/sort.js 의 STAGES)
//   등장 순서는 SORT_ORDER (없는 파일은 건너뛰고, 목록에 없는 새 이모티콘은 맨 뒤에)
const SORT_ORDER = {
  bear: ['happy_bear.png', 'best_bear.png', 'love_bear.png'],   // 싱나 → 최고! → 사랑해
  bunny: ['hello_rab.png', 'hehe_rab.png', 'kiss_rab.png'],     // 여보세용? → 히히 → 뽀뽀할래?
};
let sortAssetsP = null;
function sortAssets() {
  if (sortAssetsP) return sortAssetsP;
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const first = (arr, pref) => [...pref.filter((f) => arr.includes(f)), ...arr.filter((f) => !pref.includes(f))];
  sortAssetsP = (async () => {
    let files = [];
    try { files = (await (await fetch('assets/emoticon/list.json', { cache: 'no-cache' })).json()).map((x) => x.file); } catch {}
    const bear = first(files.filter((f) => /_bear\.png$/.test(f)), SORT_ORDER.bear).slice(0, 3);
    const bunny = first(files.filter((f) => /_rab\.png$/.test(f)), SORT_ORDER.bunny).slice(0, 3);
    const imgs = async (arr, fb) => (await Promise.all((arr.length ? arr : [fb]).map((f) => load('assets/emoticon/' + f)))).filter(Boolean);
    const [b, r, bg] = await Promise.all([imgs(bear, 'happy_bear.png'), imgs(bunny, 'hello_rab.png'), load('assets/comic.jpg')]);
    return { bear: b, bunny: r, bg };
  })();
  return sortAssetsP;
}

// 키우기 화면의 강아지 SVG → 게임용 그림 2장 (웃는 얼굴 / 놀란 얼굴)
// 나중에 직접 그린 그림(PNG/SVG 동작별)이 생기면 여기서 그 파일들을 불러오면 돼
function dogImages() {
  const src = document.querySelector('#petPet svg');
  const mk = (hide) => new Promise((res) => {
    const c = src.cloneNode(true);
    c.querySelectorAll(hide).forEach((n) => n.remove());
    c.setAttribute('width', '200'); c.setAttribute('height', '214');
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
  });
  return Promise.all([mk('.dg-sad'), mk('.dg-happy')]).then(([happy, scared]) => ({ happy, scared }));
}

function gameRecord(key) {
  const g = (pet.data && pet.data.games && pet.data.games[key]) || {};
  return { best: g.best || {}, plays: g.day === todayYmd() ? (g.plays || {}) : {} };
}
function renderGameRec() {
  const G = GAMES[gm.key], { best, plays } = gameRecord(gm.key), me = getMe();
  const parts = BDAY_WHO.map(([w, icon, name]) => `${icon} ${name} ${best[w] ? G.fmt(best[w]) : '-'}`);
  $('gameRec').textContent = `🏆 최고 기록  ${parts.join(' · ')}` +
    (me ? `\n⭐ 오늘 경험치 받을 수 있는 판: ${Math.max(0, GAME_DAILY - (plays[me] || 0))}/${GAME_DAILY}` : '\n⚙️ 설정에서 "나는 누구?"를 고르면 기록이 남아');
}
function gameScreen(kind, data = {}) {   // kind: ready | over | pause
  const G = GAMES[gm.key], box = $('gameOver');
  box.hidden = false; box.innerHTML = '';
  const add = (cls, text) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; box.appendChild(p); };
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn green';
  if (kind === 'ready') {
    add('go-title', '준비됐어? 🐶'); add('go-sub', G.help);
    btn.textContent = '시작!'; btn.onclick = startGame;
  } else if (kind === 'pause') {
    add('go-title', '잠깐 멈췄어 ⏸️');
    btn.textContent = '계속하기'; btn.onclick = () => { box.hidden = true; gm.game.resume(); };
  } else {
    add('go-title', data.best ? `🎉 신기록! ${G.fmt(data.score)}` : `${G.fail} ${G.fmt(data.score)}`);
    const name = pet.data ? pet.data.name : '';
    add('go-sub', data.exp ? `${name}${josa(name, '이', '가')} ⭐ 경험치 +${data.exp}${data.lvUp ? ` · 레벨 업! Lv.${data.lvUp} 🎉` : ''}`
      : data.capped ? `오늘 경험치는 다 받았어 (하루 ${GAME_DAILY}판). 기록 도전은 계속 OK!` : (data.note || ''));
    if (data.extra) add('go-sub', data.extra);
    if (data.partner) add('go-sub', data.partner);
    btn.textContent = '한 번 더!'; btn.onclick = startGame;
  }
  box.appendChild(btn);
  btn.focus({ preventScroll: true });
}

async function openGame(key) {
  if (!pet.data || !GAMES[key]) return;
  const G = GAMES[key];
  gm.key = key;
  $('gameTitle').textContent = G.title;
  $('gameCanvas').setAttribute('aria-label', `${G.title} 게임 화면. ${G.help}`);
  Object.values(GAMES).forEach((g) => { $(g.ctrl).hidden = g !== G; });
  $('gameSheet').hidden = false;
  renderGameRec();
  if (!gm.imgs) gm.imgs = await dogImages();
  if (gm.game) gm.game.destroy();
  const them = partnerOf(getMe());
  const extra = G.load ? await G.load() : {};
  if (gm.key !== key || $('gameSheet').hidden) return;   // 그림 불러오는 동안 닫거나 다른 게임을 눌렀으면 그만
  gm.game = new G.Cls($('gameCanvas'), { ...gm.imgs, ...extra }, { thrower: them ? WHO[them].icon : '🐰' });
  gm.game.resize(); gm.game.reset(); gm.game.draw();
  gameScreen('ready');
}
function closeGame() {
  if (gm.game) gm.game.stop();
  gm.playing = false;
  $('gameSheet').hidden = true;
}
async function startGame() {
  $('gameOver').hidden = true;
  gm.playing = true;
  const game = gm.game, key = gm.key;
  const score = await game.start();
  gm.playing = false;
  if ($('gameSheet').hidden || gm.game !== game) return;
  const res = await finishGame(key, GAMES[key].round(score));
  if ((key === 'ball' || key === 'sort') && game.maxCombo >= 2) res.extra = `최대 ${game.maxCombo} 콤보 🔥`;
  gameScreen('over', res);
  renderGameRec();
}
async function finishGame(key, score) {
  const G = GAMES[key], me = getMe(), today = todayYmd(), res = { score, exp: 0, best: false, capped: false };
  if (!me) { res.note = '⚙️ 설정에서 "나는 누구?"를 고르면 경험치랑 기록이 남아'; return res; }
  if (!pet.data) return res;
  const before = petLevel(pet.data.exp).lv;
  let expAfter = pet.data.exp || 0;
  await petMutate((cur) => {
    const q = normPet(cur);
    if (!q) return cur;
    const games = { ...(q.games || {}) }, L = games[key] || {};
    const plays = L.day === today ? { ...(L.plays || {}) } : {};
    const best = { ...(L.best || {}) };
    const n = plays[me] || 0;
    res.best = score > (best[me] || 0); if (res.best) best[me] = score;
    res.capped = n >= GAME_DAILY;
    res.exp = res.capped || score <= 0 ? 0 : G.exp(score);
    if (res.exp > 0) plays[me] = n + 1;   // 0점 판은 횟수에 안 셈
    games[key] = { best, day: today, plays };
    expAfter = (q.exp || 0) + res.exp;
    return { ...q, exp: expAfter, games };
  });
  const after = petLevel(expAfter).lv;
  if (after > before) res.lvUp = after;
  const them = partnerOf(me), tb = gameRecord(key).best[them];
  if (tb && score < tb) res.partner = `${WHO[them].icon} ${WHO[them].name} 기록까지 ${G.fmt(G.round(tb - score))} 남았어!`;
  else if (tb && res.best) res.partner = `${WHO[them].icon} ${WHO[them].name} 기록(${G.fmt(tb)})을 넘었어! 😎`;
  return res;
}

if ($('gameSheet')) {
  $('gameLogBtn').addEventListener('click', () => openGame('log'));
  $('gameBallBtn').addEventListener('click', () => openGame('ball'));
  $('gameRunBtn').addEventListener('click', () => openGame('run'));
  $('gameSortBtn').addEventListener('click', () => openGame('sort'));
  $('gameClose').addEventListener('click', closeGame);
  // 터치 반응이 늦으면 억울하니까 click 말고 pointerdown
  const on = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); if (gm.game) fn(gm.game); });
  on('gameBack', (g) => g.push(-1));
  on('gameFwd', (g) => g.push(+1));
  on('gameCatch', (g) => g.tap());
  on('gameSortL', (g) => g.pick(-1));
  on('gameSortR', (g) => g.pick(+1));
  // 허들: 점프는 누르는 동안 더 높이, 숙이기는 누르고 있는 동안만
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} if (gm.game) down(gm.game); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, () => { if (gm.game) up(gm.game); }));
  };
  hold('gameJump', (g) => g.jump(), (g) => g.release());
  hold('gameDuck', (g) => g.duck(true), (g) => g.duck(false));
  $('gameCanvas').addEventListener('pointerup', () => { if (gm.key === 'run' && gm.game) gm.game.release(); });
  $('gameCanvas').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!gm.game) return;
    if (gm.key === 'ball') { gm.game.tap(); return; }
    if (gm.key === 'run') { gm.game.jump(); return; }   // 화면 누르기 = 점프
    const r = e.currentTarget.getBoundingClientRect(), side = e.clientX - r.left < r.width / 2 ? -1 : +1;
    if (gm.key === 'sort') { gm.game.pick(side); return; }   // 화면 왼쪽 = 🐰, 오른쪽 = 🐻
    gm.game.push(side);
  });
  document.addEventListener('keydown', (e) => {
    if ($('gameSheet').hidden || !gm.game) return;
    if (e.key === 'Escape') closeGame();
    else if (gm.key === 'log' && e.key === 'ArrowLeft') { e.preventDefault(); gm.game.push(-1); }
    else if (gm.key === 'log' && e.key === 'ArrowRight') { e.preventDefault(); gm.game.push(+1); }
    else if (gm.key === 'ball' && (e.key === ' ' || e.key === 'ArrowUp') && $('gameOver').hidden) { e.preventDefault(); if (!e.repeat) gm.game.tap(); }
    else if (gm.key === 'run' && (e.key === ' ' || e.key === 'ArrowUp') && $('gameOver').hidden) { e.preventDefault(); if (!e.repeat) gm.game.jump(); }
    else if (gm.key === 'run' && e.key === 'ArrowDown') { e.preventDefault(); gm.game.duck(true); }
    else if (gm.key === 'sort' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && $('gameOver').hidden) { e.preventDefault(); if (!e.repeat) gm.game.pick(e.key === 'ArrowLeft' ? -1 : +1); }
  });
  document.addEventListener('keyup', (e) => {
    if ($('gameSheet').hidden || !gm.game || gm.key !== 'run') return;
    if (e.key === ' ' || e.key === 'ArrowUp') gm.game.release();
    else if (e.key === 'ArrowDown') gm.game.duck(false);
  });
  // 다른 앱 갔다 오면 일시정지
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && gm.playing && gm.game && (gm.game.state === 'play' || gm.game.state === 'count')) { gm.game.pause(); gameScreen('pause'); }
  });
}

/* ====================== 푸시 알림 ====================== */
// 알림 서버(Cloudflare Worker) 주소는 config.js 의 PUSH_URL. 비어 있으면 알림 기능은 숨겨져.
// 커플 ID / 비밀값은 문장 비밀번호에서 만들어서 둘만 알아 (서버엔 비밀값의 해시만 저장됨)
// 알림 문구는 서버에 정해져 있어서, 사진·답 내용은 서버로 안 가.
const PUSH_URL = String(CFG.PUSH_URL || '').replace(/\/+$/, '');
const PUSH_SYNC_KEY = 'couple-push-sync';
const push = { c: '', s: '', reg: null };
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64uDec = (s) => b64.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));

async function initPush() {
  if (!PUSH_URL || !$('pushRow')) return;
  push.c = await sha256hex(state.docId + ':push-id');
  push.s = await sha256hex(state.docId + ':push-secret');
  $('pushRow').hidden = false;
  if ('serviceWorker' in navigator) {
    try { push.reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.error(e); }
  }
  await renderPush();
  // 이미 켜 둔 기기는 하루 한 번 서버에 다시 등록 ("나는 누구?" 바뀐 것 반영, 정리된 기기 복구)
  try {
    const sub = push.reg && push.reg.pushManager && await push.reg.pushManager.getSubscription();
    const mark = todayYmd() + (getMe() || '');
    if (sub && Notification.permission === 'granted' && getMe() && lsGet(PUSH_SYNC_KEY, '') !== mark) {
      await pushPost('/subscribe', { who: getMe(), sub: sub.toJSON() });
      lsSet(PUSH_SYNC_KEY, mark);
    }
  } catch (e) { console.warn('push sync', e.message); }
}

// text/plain 으로 보내면 '단순 요청'이라 CORS 사전 확인(preflight)이 없어서
// 아이폰 사파리에서도 안정적이야 (서버는 내용만 JSON으로 읽음)
async function pushPost(path, body, keepalive = false) {
  const r = await fetch(PUSH_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive,
    body: JSON.stringify({ c: push.c, s: push.s, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `서버 응답 ${r.status}`);
  return j;
}

async function renderPush() {
  const btn = $('pushBtn'), note = $('pushNote');
  btn.disabled = false; btn.dataset.on = '';
  if (isIOS && !isStandalone()) {
    btn.textContent = '🔔 알림 켜기'; btn.disabled = true;
    note.textContent = '아이폰은 홈 화면에 추가한 앱으로 열어야 알림을 켤 수 있어'; return;
  }
  if (!pushSupported() || !push.reg) { btn.textContent = '🔔 알림'; btn.disabled = true; note.textContent = '이 브라우저는 알림을 지원하지 않아'; return; }
  if (Notification.permission === 'denied') { btn.textContent = '🔕 알림 차단됨'; btn.disabled = true; note.textContent = '휴대폰 설정에서 이 앱의 알림을 허용해 줘'; return; }
  const sub = await push.reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    btn.textContent = '🔔 알림 켜짐'; btn.dataset.on = '1';
    note.textContent = '이 기기로 알림이 와 (누르면 끄기)';
  } else {
    btn.textContent = '🔔 알림 켜기';
    note.textContent = '상대가 이모티콘·질문·사진·일정을 올리면 알려 줘';
  }
}

async function togglePush() {
  const btn = $('pushBtn'), note = $('pushNote');
  if (!getMe()) { note.textContent = '먼저 위에서 🐻/🐰 "나는 누구?"를 골라 줘'; return; }
  const turningOn = !btn.dataset.on;
  // ⚠️ 아이폰은 '버튼 누른 그 순간'에 권한을 물어봐야 해서 제일 먼저 호출
  const perm = turningOn ? await Notification.requestPermission() : Notification.permission;
  btn.disabled = true;
  try {
    let sub = await push.reg.pushManager.getSubscription();
    if (!turningOn) {
      if (sub) { await pushPost('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    } else {
      if (perm !== 'granted') { await renderPush(); return; }
      const { key } = await (await fetch(PUSH_URL + '/vapid')).json();
      const old = sub && sub.options && sub.options.applicationServerKey;
      if (sub && old && b64.to(new Uint8Array(old)) !== b64.to(b64uDec(key))) { await sub.unsubscribe(); sub = null; }   // 서버 키가 바뀌었으면 다시
      if (!sub) sub = await push.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uDec(key) });
      await pushPost('/subscribe', { who: getMe(), sub: sub.toJSON() });
      lsSet(PUSH_SYNC_KEY, todayYmd() + getMe());
    }
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    note.textContent = `⚠️ 알림 설정을 못 했어 (${e.message})`;
    return;
  }
  await renderPush();
}

// 상대에게 알림 (실패해도 조용히 넘어감)
async function notifyPartner(type, extra = {}) {
  const to = partnerOf(getMe());
  if (!PUSH_URL || !push.c || !to) return;
  try { await pushPost('/notify', { to, type, ...extra }, true); } catch (e) { console.warn('notify', type, e.message); }
}

if ($('pushBtn')) {
  $('pushBtn').addEventListener('click', togglePush);
}

boot();
