// ======================== Service Worker · 离线缓存 ========================
// 部署：GitHub Pages 子路径（/repo/）兼容——全部使用相对路径，注册时用 'sw.js'。
// 重要：每次修改 app.js / index.html / style.css / songs.json 后，请把 VERSION 升一级，
//       旧缓存会在激活时自动清理，用户下次打开即为最新版。
const VERSION = 'songbook-v33';
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
// 关键资源：缺失任意一个都会导致页面无法渲染（卡开屏/白屏），预缓存时必须重试确保到位
const CRITICAL = ['./', 'index.html', 'style.css', 'app.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 关键资源：最多重试 3 次，确保 index.html/app.js/style.css 一定入库
    let criticalOk = true;
    for (const u of CRITICAL) {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try { await cache.add(u); ok = true; }
        catch (err) { console.warn('[SW] 关键资源预缓存重试', u, '尝试', attempt + 1, err); }
      }
      if (!ok) criticalOk = false;
    }
    if (!criticalOk) console.warn('[SW] 关键资源预缓存仍失败（设备可能离线）；联网打开时将由 network-first 自动拉取最新页面');
    // 非关键资源（图标/manifest/数据）容忍个别失败
    await Promise.allSettled(
      APP_SHELL.filter(u => !CRITICAL.includes(u)).concat([DATA_URL]).map(u => cache.add(u))
    );
    // 始终激活新 SW：靠 fetch 的 network-first 自愈（联网即渲染最新），避免“离线安装→新SW卡在 waiting→旧版(坏的)永远控场”的死锁
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
    // 注意：不做自动刷新页面——演出中途 reload 会丢失未保存状态，下次打开自然生效
  );
});

// 导航/数据：network-first（先拿网络最新版，失败再回退缓存）——根治“更新后缓存残缺卡开屏”
function networkFirst(req, cacheKey) {
  return caches.open(VERSION).then(cache =>
    fetch(req).then(res => {
      if (res.ok) cache.put(cacheKey || req, res.clone());
      return res;
    }).catch(() => {
      const key = cacheKey || req;
      return caches.match(key, { ignoreSearch: true })
        .then(hit => hit || cache.match(req, { ignoreSearch: true }))
        .then(h => h || Promise.reject('offline-and-no-cache'));
    })
  );
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // 保存到 GitHub 的 PUT 等请求直连网络
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // api.github.com 等跨域请求直连网络

  const path = url.pathname;

  // 数据文件：network-first。页面 fetch 带 ?t=时间戳，缓存 key 统一用裸路径，避免堆积
  if (path.endsWith('/' + DATA_URL) || path === '/' + DATA_URL) {
    e.respondWith(networkFirst(req, DATA_URL));
    return;
  }

  // 页面导航：network-first，保证永远先取最新 HTML，杜绝“坏缓存把应用砖了”
  if (req.mode === 'navigate' || path.endsWith('/') || path.endsWith('/index.html')) {
    e.respondWith(networkFirst(req, null));
    return;
  }

  // 代码资源(app.js/style.css)：network-first，保证升版后永远先取最新，杜绝旧缓存锁死版本号
  if (path.endsWith('/app.js') || path.endsWith('/style.css')) {
    e.respondWith(networkFirst(req, null));
    return;
  }

  // 其它外壳资源(图标/manifest)：cache-first + 回源写入（离线秒开，几乎不变更）
  e.respondWith(cacheFirst(req));
});

// cache-first + 回源写入（离线秒开；命中即返回，后台不强制联网核对）
function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => hit || caches.match(req)));
}
