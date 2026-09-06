/* Service worker do Aprendiz.
 *
 * O app inteiro cabe em cinco arquivos e nao fala com servidor nenhum, entao
 * aqui e' cache-primeiro de verdade: depois da primeira visita ele abre no
 * aviao, no metro, sem sinal. Nao ha nada que possa estar "desatualizado"
 * alem do proprio codigo -- e para isso serve trocar o nome do cache.
 */
const CACHE = "aprendiz-v1";
const TUDO = ["./", "./index.html", "./jogo.js", "./cerebro.js", "./manifest.json", "./icone.svg"];

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
  e.respondWith(
    caches.match(e.request).then((achou) => achou || fetch(e.request))
  );
});
