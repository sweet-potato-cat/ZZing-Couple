import * as CFG from './config.js';
import { QUESTIONS } from './questions.js?v=1';

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
// 둘이 같이 쓰는 설정: couples/{sha256(docId + ':settings')} = 암호화된 { start, firstDay }  → 상대 화면도 같이 바뀜
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
  };
};
const sett = { store: null, data: normSet(lsRead(SET_CACHE, null)) };
const prefs = () => { const p = rawSet(lsRead(PREF_KEY, {})); return { film: p.film !== false, stamp: p.stamp !== false }; };
const ymdToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// 만난 날부터 d날짜까지 며칠째인지 (설정 따라 1일/0일부터)
const dayNumber = (d) => Math.round((d - ymdToDate(sett.data.start)) / 86400000) + (sett.data.firstDay ? 1 : 0);

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
  if (!$('setSheet').hidden && document.activeElement !== $('setStart')) fillSettings();
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
  const p = prefs();
  $('prefFilm').checked = p.film; $('prefStamp').checked = p.stamp;
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
['prefFilm', 'prefStamp'].forEach((id) => $(id).addEventListener('change', () =>
  lsWrite(PREF_KEY, { film: $('prefFilm').checked, stamp: $('prefStamp').checked })));
// "나는 누구?"가 바뀌면 그걸 쓰는 화면들 다시 그리기
document.addEventListener('mechange', () => {
  for (const f of [renderQna, renderRecipes]) { try { f(); } catch {} }
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
    });
  } catch (e) {
    console.error(e);
    status.textContent = '⚠️ Firebase에 연결하지 못해서 지금은 사진을 올릴 수 없어.';
    setUploadEnabled(false);
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
    const an = annivOf(ds);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') +
      (ds === today ? ' today' : '') + (ds === cal.sel ? ' sel' : '');
    cell.setAttribute('aria-label', `${m + 1}월 ${n}일` + (an ? `, ${an}` : '') + (evs.length ? `, 일정 ${evs.length}개` : ''));
    cell.setAttribute('aria-pressed', String(ds === cal.sel));

    const num = document.createElement('span'); num.className = 'n'; num.textContent = n;
    cell.appendChild(num);

    const pills = [];
    if (an) pills.push({ text: an, cls: 'anniv' });
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

  const an = annivOf(cal.sel);
  if (an) {
    const li = document.createElement('li');
    const who = document.createElement('span'); who.className = 'who anniv'; who.textContent = '♥';
    const t = document.createElement('span'); t.className = 'txt'; t.textContent = `우리 ${an}`;
    li.append(who, t); list.appendChild(li);
  }

  const evs = by[cal.sel] || [];
  if (!evs.length && !an) {
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
  if (!next) { sub.textContent = '날짜를 누르고 일정을 적어 봐'; return; }
  const dd = Math.round((parseYmd(next.date) - parseYmd(today)) / 86400000);
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
const nav = { secs: [], btns: [], cur: -1, idleT: 0, labelT: 0, drag: null, raf: 0 };

function initDotNav() {
  const rail = $('dotRail');
  if (!rail || nav.secs.length) return;
  nav.secs = [...document.querySelectorAll('.scene[data-nav]')];
  nav.btns = nav.secs.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', `${s.dataset.nav}(으)로 가기`);
    b.appendChild(document.createElement('i'));
    b.addEventListener('click', (e) => { if (e.detail === 0) goToSection(i, 'smooth'); });   // 키보드(Enter)용
    rail.appendChild(b);
    return b;
  });
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
