/* Service worker do Reino: cache-primeiro, porque o jogo inteiro sao cinco
   arquivos e nao fala com servidor nenhum. Depois da primeira visita abre
   sem sinal. Trocar o nome do cache e' o que publica versao nova. */
const CACHE = "reino-v1";
const TUDO = ["./", "./index.html", "./reino.js", "./cidade.js", "./manifest.json", "./icone.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(TUDO)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then((a) => a || fetch(e.request)));
});
