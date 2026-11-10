import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import { API_ORIGIN } from './lib/api'

const root = createRoot(document.getElementById('root')!)

function renderApplication() {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )

  if (window.isSecureContext && 'serviceWorker' in navigator) {
    const registerServiceWorker = () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
        })
        .catch((error: unknown) => {
          console.warn('مواردي: تعذر تسجيل عامل الخدمة.', error)
        })
    }

    if (document.readyState === 'complete') {
      registerServiceWorker()
    } else {
      window.addEventListener('load', registerServiceWorker, { once: true })
    }
  }
}

async function redirectPagesToSameOrigin(): Promise<boolean> {
  if (
    !import.meta.env.PROD ||
    window.location.hostname !== 'azzam200022.github.io' ||
    !API_ORIGIN ||
    API_ORIGIN === window.location.origin
  ) {
    return false
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)

  try {
    // Redirect only after the API host is serving this app, not while it is still API-only
    // or showing a transient hosting error page.
    const response = await fetch(`${API_ORIGIN}/`, {
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return false

    const html = await response.text()
    if (!html.includes('<div id="root"></div>')) return false

    const basePath = import.meta.env.BASE_URL
    const routePath = window.location.pathname.startsWith(basePath)
      ? window.location.pathname.slice(basePath.length)
      : ''
    const target = new URL(routePath ? `/${routePath}` : '/', `${API_ORIGIN}/`)
    target.search = window.location.search
    target.hash = window.location.hash
    window.location.replace(target.toString())
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

if (import.meta.env.PROD && window.location.hostname === 'azzam200022.github.io' && API_ORIGIN) {
  root.render(
    <div className="flex min-h-svh items-center justify-center bg-slate-50 text-sm text-slate-600" dir="rtl">
      جارٍ فتح مواردي…
    </div>,
  )
  void redirectPagesToSameOrigin().then((redirected) => {
    if (!redirected) renderApplication()
  })
} else {
  renderApplication()
}
