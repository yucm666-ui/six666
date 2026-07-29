// ======================== Service Worker · 离线缓存 ========================
// 部署：GitHub Pages 子路径（/repo/）兼容——全部使用相对路径，注册时用 'sw.js'。
// 重要：每次修改 app.js / index.html / style.css / songs.json 后，请把 VERSION 升一级，
//       旧缓存会在激活时自动清理，用户下次打开即为最新版。
const VERSION = 'songbook-v9';
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];
const DATA_URL = 'songs.json'; // 数据文件：在线永远拿最新，离线回退上次缓存

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // 逐个缓存并容忍个别失败（如图标临时 404）：避免一个资源坏掉导致整个离线功能报废
      .then(c => Promise.allSettled(APP_SHELL.concat([DATA_URL]).map(u => c.add(u))))
      .then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed) console.warn('SW 预缓存有 ' + failed + ' 个资源失败（已跳过）');
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
    // 注意：不做自动刷新页面——演出中途 reload 会丢失未保存状态，下次打开自然生效
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // 保存到 GitHub 的 PUT 等请求直连网络
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // api.github.com 等跨域请求直连网络

  // 数据文件：network-first。页面 fetch 带 ?t=时间戳，缓存 key 统一用裸路径，避免堆积
  if (url.pathname.endsWith('/' + DATA_URL) || url.pathname === '/' + DATA_URL) {
    e.respondWith(
      caches.open(VERSION).then(cache =>
        fetch(req).then(res => {
          if (res.ok) cache.put(DATA_URL, res.clone());
          return res;
        }).catch(() => cache.match(DATA_URL).then(hit => hit || cache.match(req, { ignoreSearch: true })))
      )
    );
    return;
  }

  // 应用外壳（html/css/js/图标）：cache-first，未命中回源并写入缓存
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
