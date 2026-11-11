const CACHE_PREFIX = 'azo-hr-pwa-'
const CACHE_NAME = `${CACHE_PREFIX}v3`
const appScope = new URL(self.registration.scope)
const appShellUrl = new URL('./', appScope).href
const notificationBadgeUrl = new URL('notification-badge.png', appScope).href
const assetsPath = new URL('assets/', appScope).pathname
const apiPath = new URL('api/', appScope).pathname
const manifestPath = new URL('manifest.webmanifest', appScope).pathname
const pwaIconPaths = new Set([
  new URL('pwa-192.png', appScope).pathname,
  new URL('pwa-512.png', appScope).pathname,
  new URL('notification-badge.png', appScope).pathname,
])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.add(appShellUrl)
      await cache.add(notificationBadgeUrl)
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

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {}
      try {
        payload = event.data?.json() ?? {}
      } catch {
        payload = { body: event.data?.text() ?? '' }
      }

      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const visibleAppIsOpen = windows.some((client) => {
        const url = new URL(client.url)
        return (
          url.origin === self.location.origin &&
          url.pathname.startsWith(appScope.pathname) &&
          client.visibilityState === 'visible'
        )
      })
      if (visibleAppIsOpen) return

      const notification = payload.notification ?? payload
      const title = notification.title ?? payload.title ?? 'مواردي — إشعار جديد'
      const body =
        notification.body ?? payload.body ?? 'لديك تحديث جديد. افتح التطبيق للاطلاع على التفاصيل.'
      const notificationData = payload.data ?? {}

      await self.registration.showNotification(title, {
        body,
        dir: 'rtl',
        lang: 'ar',
        tag: payload.tag ?? 'mawaridi',
        icon: new URL('pwa-192.png', appScope).href,
        badge: notificationBadgeUrl,
        data: {
          ...notificationData,
          url: appShellUrl,
        },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const targetUrl = new URL(
        event.notification.data?.url ?? appShellUrl,
        appScope,
      )
      const url = targetUrl.origin === self.location.origin ? targetUrl.href : appShellUrl
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of windows) {
        const clientUrl = new URL(client.url)
        if (
          clientUrl.origin === self.location.origin &&
          clientUrl.pathname.startsWith(appScope.pathname)
        ) {
          await client.focus()
          await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
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
