import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileRenderOptions {
  sitekey: string
  action: string
  theme: 'light' | 'dark'
  language: 'en' | 'fr'
  size: 'normal' | 'compact'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
  'timeout-callback': () => void
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_URL}"]`)
    const script = existingScript ?? document.createElement('script')
    const handleLoad = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('Turnstile did not initialize'))
    }
    const handleError = () => {
      scriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existingScript) {
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })
  return scriptPromise
}

interface TurnstileWidgetProps {
  siteKey: string
  resetKey: number
  label: string
  language: 'en' | 'fr'
  theme: 'light' | 'dark'
  onVerified: (token: string) => void
  onUnavailable: () => void
  onExpired: () => void
}

export function TurnstileWidget({
  siteKey,
  resetKey,
  label,
  language,
  theme,
  onVerified,
  onUnavailable,
  onExpired,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<'normal' | 'compact' | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const sizingContainer = container.parentElement ?? container

    const updateSize = (width: number) => {
      const nextSize = width >= 300 ? 'normal' : 'compact'
      setSize((currentSize) => currentSize === nextSize ? currentSize : nextSize)
    }
    updateSize(container.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(0)
      if (entry) updateSize(entry.contentRect.width)
    })
    observer.observe(sizingContainer)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    let widgetId: string | null = null
    if (!siteKey) {
      onUnavailable()
      return
    }
    if (!size) return

    void loadTurnstile().then((turnstile) => {
      if (!active || !containerRef.current) return
      widgetId = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: 'exam-request',
        theme,
        language,
        size,
        callback: onVerified,
        'error-callback': onUnavailable,
        'expired-callback': onExpired,
        'timeout-callback': onExpired,
      })
    }).catch(() => {
      if (active) onUnavailable()
    })

    return () => {
      active = false
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, resetKey, language, theme, size, onVerified, onUnavailable, onExpired])

  return <div ref={containerRef} className="turnstile-widget" data-size={size ?? undefined} aria-label={label} />
}
