import { isIP } from 'node:net'

function validAddress(value: string): string | undefined {
  const candidate = value.trim()
  if (isIP(candidate)) return candidate

  const bracketed = /^\[([^\]]+)](?::\d{1,5})?$/.exec(candidate)
  if (bracketed?.[1] && isIP(bracketed[1])) return bracketed[1]

  const ipv4WithPort = /^([^:]+):(\d{1,5})$/.exec(candidate)
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1]) === 4) return ipv4WithPort[1]
  return undefined
}

/**
 * Azure's front end appends the connected client hop to X-Forwarded-For. Only the rightmost hop
 * is considered; attacker-controlled values prepended to the header are never searched or trusted.
 * If that platform-appended hop is absent or malformed, IP rate limiting is skipped as a
 * best-effort layer and Turnstile remains mandatory.
 */
export function trustedClientAddress(xForwardedFor: string | null): string | undefined {
  if (!xForwardedFor) return undefined
  const hops = xForwardedFor.split(',')
  return validAddress(hops.at(-1) ?? '')
}