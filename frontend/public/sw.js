const CACHE_PREFIX = 'azo-hr-pwa-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const appScope = new URL(self.registration.scope)
const appShellUrl = new URL('./', appScope).href
const assetsPath = new URL('assets/', appScope).pathname
const apiPath = new URL('api/', appScope).pathname
const manifestPath = new URL('manifest.webmanifest', appScope).pathname
const pwaIconPaths = new Set([
  new URL('pwa-192.png', appScope).pathname,
  new URL('pwa-512.png', appScope).pathname,
])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.add(appShellUrl)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(appScope.pathname)) return
  if (url.pathname.startsWith(apiPath)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(appShellUrl, response.clone())
          }
          return response
        } catch {
          return (await caches.match(appShellUrl)) ?? Response.error()
        }
      })(),
    )
    return
  }

  const isAppAsset =
    url.pathname.startsWith(assetsPath) ||
    url.pathname === manifestPath ||
    pwaIconPaths.has(url.pathname)
  if (!isAppAsset) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone())
      }
      return response
    })(),
  )
})
