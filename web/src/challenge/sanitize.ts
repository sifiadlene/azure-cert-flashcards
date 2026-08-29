import DOMPurify from 'dompurify'

export function sanitizeChallengeHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'br', 'code', 'em', 'strong'],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  })
  return sanitized.replace(/<a\s/gi, '<a target="_blank" rel="noreferrer" ')
}
