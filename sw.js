// 알림 받는 부품 (Service Worker)
// 앱이 꺼져 있어도 알림 서버가 보낸 알림을 받아서 화면에 띄워 줘.
// ⚠️ 일부러 캐시(오프라인 저장)는 안 해. 그래야 사이트를 고쳤을 때 바로 반영돼.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '곰돌찡 ♥ 토끼찡', {
    body: d.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: d.tag || 'zzing',
    renotify: true,
    data: { url: d.url || './' },
  }));
});

// 알림 누르면: 열려 있는 앱으로 가고, 없으면 새로 열기
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow(new URL(e.notification.data.url || './', self.registration.scope).href);
  })());
});
