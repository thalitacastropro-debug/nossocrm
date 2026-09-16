/* eslint-disable no-restricted-globals */
// Minimal Service Worker (MVP): cache app shell assets for faster launch.
// Note: This does NOT provide offline data sync.

// ⚠️ SUBA ESTE NÚMERO SEMPRE QUE UM CONSERTO PRECISAR CHEGAR HOJE NA MÁQUINA DE ALGUÉM.
//
// Este arquivo é o que o navegador compara para decidir se o service worker mudou. Enquanto ele
// for byte-idêntico, o SW instalado continua o mesmo e o `activate` logo abaixo — que é quem APAGA
// os caches antigos — nunca roda. Mudar a versão é o único gesto que limpa a casa de todo mundo:
// `install` chama `skipWaiting()` e `activate` faz `clients.claim()`, então o SW novo assume já no
// primeiro carregamento, sem depender de fechar as abas.
//
// 16/09/2026: o conserto que destravava a criação de negócio do Pedro entrou em produção e ele
// continuou batendo no MESMO erro — o navegador dele seguia executando o JS antigo, e um F5 não
// resolveu. Dava para ver no log do Supabase: o código novo faz uma busca antes de gravar a
// empresa e duas chamadas de autenticação ao criar o contato, e as requisições dele não tinham
// nenhuma das duas.
const CACHE_NAME = 'nossocrm-shell-v3';
const SHELL_URLS = [
  '/',
  '/login',
  '/boards',
  '/inbox',
  '/contacts',
  '/activities',
  '/icons/icon.svg',
  '/icons/maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for navigations, fallback to cache if offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

