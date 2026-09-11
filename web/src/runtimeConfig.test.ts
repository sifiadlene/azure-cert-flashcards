import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRuntimeConfig, publicApiBase } from './runtimeConfig'

describe('runtime configuration', () => {
  beforeEach(async () => {
    await loadRuntimeConfig(vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ publicApiBase: '/api' }), { status: 200 }),
    ))
  })

  it('loads an HTTPS API endpoint without using the HTTP cache', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ publicApiBase: 'https://target.example.test/api' }), { status: 200 }),
    )

    await loadRuntimeConfig(fetcher)

    expect(fetcher).toHaveBeenCalledWith('/config.json', { cache: 'no-store' })
    expect(publicApiBase()).toBe('https://target.example.test/api')
  })

  it.each([
    'http://target.example.test/api',
    'https://user:secret@target.example.test/api',
    'https://target.example.test/not-api',
  ])('rejects unsafe API endpoint %s', async (publicApiBaseValue) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ publicApiBase: publicApiBaseValue }), { status: 200 }),
    )

    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('invalid publicApiBase')
  })
})