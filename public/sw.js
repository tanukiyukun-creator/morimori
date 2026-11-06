const CACHE_NAME = "morimori-v1";

const APP_FILES = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/manifest.webmanifest"
];

/*
 * 初回インストール
 */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});


/*
 * 古いキャッシュを削除
 */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});


/*
 * 通信処理
 *
 * APIやSocket.IOはキャッシュせず、
 * アプリ本体だけキャッシュする。
 */
self.addEventListener("fetch", event => {

  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * APIは常にネットワーク
   */
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io/")
  ) {
    return;
  }

  /*
   * 外部サイトへの通信は対象外
   */
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {

        /*
         * 正常なレスポンスをキャッシュ
         */
        if (response.ok) {
          const copy = response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache => {
              cache.put(request, copy);
            });
        }

        return response;
      })
      .catch(() => {

        /*
         * オフライン時はキャッシュから返す
         */
        return caches.match(request)
          .then(cached => {

            if (cached) {
              return cached;
            }

            /*
             * ページがなければトップへ
             */
            if (request.mode === "navigate") {
              return caches.match("/");
            }

            return new Response(
              "オフラインです。",
              {
                status: 503,
                headers: {
                  "Content-Type": "text/plain; charset=utf-8"
                }
              }
            );
          });

      })
  );
});
