/**
 * Encode/decode the editor source into the URL fragment so links are fully
 * self-contained. No server, no storage. We use a UTF-8-safe base64 (via
 * percent-encoding to handle Cyrillic, etc.).
 */

const HASH_KEY = "src"

export function encodeSourceToHash(source: string): string {
  const b64 = btoa(unescape(encodeURIComponent(source)))
  return `#${HASH_KEY}=${b64}`
}

export function decodeSourceFromHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null
  const params = new URLSearchParams(hash.slice(1))
  const b64 = params.get(HASH_KEY)
  if (!b64) return null
  try {
    return decodeURIComponent(escape(atob(b64)))
  } catch {
    return null
  }
}

export function shareLink(source: string): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}${encodeSourceToHash(source)}`
}

const STORAGE_KEY = "calc.draft"

export function loadDraft(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveDraft(source: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, source)
  } catch {
    // Quota exceeded or storage disabled — silently no-op.
  }
}
