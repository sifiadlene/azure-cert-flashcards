export interface RuntimeConfig {
  publicApiBase: string
}

const DEFAULT_CONFIG: RuntimeConfig = { publicApiBase: '/api' }

let runtimeConfig = DEFAULT_CONFIG

function validApiBase(value: unknown): value is string {
  if (value === '/api') return true
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname.replace(/\/$/, '').endsWith('/api')
  } catch {
    return false
  }
}

export async function loadRuntimeConfig(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RuntimeConfig> {
  const response = await fetcher(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Runtime configuration request failed with status ${response.status}.`)
  const value = await response.json() as unknown
  if (typeof value !== 'object' || value === null || !validApiBase(Reflect.get(value, 'publicApiBase'))) {
    throw new Error('Runtime configuration contains an invalid publicApiBase.')
  }
  runtimeConfig = { publicApiBase: Reflect.get(value, 'publicApiBase') as string }
  return runtimeConfig
}

export function publicApiBase(): string {
  return runtimeConfig.publicApiBase
}