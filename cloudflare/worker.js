// 곰돌찡 ♥ 토끼찡 알림 서버 (Cloudflare Worker)
// ─────────────────────────────────────────────────────────────
// 이 파일 전체를 Cloudflare 대시보드의 Worker 코드 편집기에 붙여넣고 Deploy 하면 돼.
// 필요한 설정은 딱 하나: KV 네임스페이스를 "PUSH" 라는 이름으로 연결(Bindings)하기.
//
// 하는 일
//   GET  /vapid        알림 공개키 (처음 부르면 키를 새로 만들어 KV에 저장. 비밀키는 KV 밖으로 안 나감)
//   POST /subscribe    이 폰으로 알림 받기 등록   { c, s, who, sub }
//   POST /unsubscribe  등록 해제                  { c, s, endpoint }
//   POST /notify       상대에게 알림 보내기        { c, s, to, type, label?, n? }
//
// 보안
//   - c = 커플 ID, s = 커플 비밀값. 둘 다 사이트의 문장 비밀번호에서 만들어져서 둘만 알아.
//     처음 등록할 때 s 의 해시를 저장하고, 그다음부터는 같은 s 를 가진 요청만 받아.
//   - 알림 문구는 여기(서버)에 정해 둔 것만 보내. 사진·답 내용은 서버로 안 와.
//   - 푸시 주소는 Apple/Google/Mozilla/Microsoft 푸시 서버만 허용.

const ALLOWED_ORIGINS = ['https://sweet-potato-cat.github.io'];
const SUBJECT = 'https://sweet-potato-cat.github.io';   // VAPID 연락처 (메일 대신 사이트 주소)
const APP_TITLE = '곰돌찡 ♥ 토끼찡';
const WHO = { bear: '🐻 곰돌찡', bunny: '🐰 토끼찡' };
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

// 알림 문구 (여기만 고치면 문구가 바뀌어)
const TEMPLATES = {
  emo: (from, x) => (x.label ? `${WHO[from]}이 "${x.label}" 보냈어` : `${WHO[from]}이 이모티콘을 보냈어`),
  qna: (from) => `${WHO[from]}이 오늘의 질문에 답했어! 🔒`,
  photo: (from, x) => `${WHO[from]}이 사진${x.n > 1 ? ` ${x.n}장을` : '을'} 올렸어 📸`,
  cal: (from) => `${WHO[from]}이 일정을 추가했어 📅`,
  test: () => '알림이 잘 와! 🔔',
};

const te = new TextEncoder();
const b64u = {
  enc(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const p = s + '==='.slice((s.length + 3) % 4); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); },
};
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const sha256hex = async (str) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(str)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ───────── VAPID 키 (서버가 스스로 만들고 KV에 보관) ─────────
async function vapidKeys(env) {
  let k = await env.PUSH.get('vapid', 'json');
  if (!k) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    k = { priv, pub };
    await env.PUSH.put('vapid', JSON.stringify(k));
  }
  return k;
}
async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', { ...keys.priv, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${keys.pub}`;
}

// ───────── 알림 내용 암호화 (RFC 8291, aes128gcm) ─────────
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function encryptPayload(sub, plaintext) {
  const uaPub = b64u.dec(sub.p256dh), auth = b64u.dec(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode('WebPush: info\0'), uaPub, localPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + localPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPub.length;
  header.set(localPub, 21);
  return concat(header, ct);
}
async function sendPush(sub, message, keys) {
  const body = await encryptPayload(sub, te.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

// ───────── 요청 처리 ─────────
const okEndpoint = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && PUSH_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith('.' + h)); }
  catch { return false; }
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.PUSH) return json({ error: 'KV 바인딩 PUSH 가 없어. Settings → Bindings 에서 연결해 줘.' }, 500);

    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/vapid') return json({ key: (await vapidKeys(env)).pub });
      if (req.method === 'GET') return json({ ok: true, hello: '🐻 ♥ 🐰 알림 서버가 잘 돌아가고 있어' });
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, 403);

      const b = await req.json().catch(() => ({}));
      const c = String(b.c || ''), s = String(b.s || '');
      if (!/^[a-f0-9]{64}$/.test(c) || !/^[a-f0-9]{64}$/.test(s)) return json({ error: 'bad id' }, 400);
      const key = 'c:' + c;
      const rec = await env.PUSH.get(key, 'json');
      const h = await sha256hex('zzing-push:' + s);
      if (rec && rec.h !== h) return json({ error: 'secret' }, 403);

      if (url.pathname === '/subscribe') {
        const sub = b.sub || {}, who = b.who;
        if (!WHO[who]) return json({ error: 'who' }, 400);
        if (!okEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: 'subscription' }, 400);
        const r = rec || { h, subs: [] };
        r.subs = r.subs.filter((x) => x.endpoint !== sub.endpoint);
        r.subs.push({ who, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, at: Date.now() });
        r.subs = r.subs.slice(-10);   // 커플당 최대 기기 10대
        await env.PUSH.put(key, JSON.stringify(r));
        return json({ ok: true, devices: r.subs.length });
      }
      if (!rec) return json({ error: 'not registered' }, 404);

      if (url.pathname === '/unsubscribe') {
        rec.subs = rec.subs.filter((x) => x.endpoint !== b.endpoint);
        await env.PUSH.put(key, JSON.stringify(rec));
        return json({ ok: true });
      }

      if (url.pathname === '/notify') {
        const tpl = TEMPLATES[b.type], to = b.to;
        if (!tpl || !WHO[to]) return json({ error: 'type/to' }, 400);
        const from = to === 'bear' ? 'bunny' : 'bear';
        const extra = {
          label: typeof b.label === 'string' ? b.label.replace(/[\u0000-\u001f"<>]/g, '').slice(0, 20) : '',
          n: Math.max(0, Math.min(99, parseInt(b.n, 10) || 0)),
        };
        const message = { title: APP_TITLE, body: tpl(from, extra), tag: b.type, url: './' };
        const targets = rec.subs.filter((x) => x.who === to);
        if (!targets.length) return json({ ok: true, sent: 0, note: '상대가 아직 알림을 안 켰어' });
        const keys = await vapidKeys(env);
        const results = await Promise.all(targets.map((t) => sendPush(t, message, keys).catch(() => 0)));
        const dead = targets.filter((t, i) => results[i] === 404 || results[i] === 410).map((t) => t.endpoint);
        if (dead.length) {   // 알림 끈 기기·지운 앱 정리
          rec.subs = rec.subs.filter((x) => !dead.includes(x.endpoint));
          await env.PUSH.put(key, JSON.stringify(rec));
        }
        return json({ ok: true, sent: results.filter((r) => r >= 200 && r < 300).length, results });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
