let csrfToken = ''

export async function refreshCsrf() {
  let response
  try {
    response = await fetch('/api/auth/csrf', { credentials: 'include' })
  } catch {
    throw new Error('The API is not reachable. Start PostgreSQL, then run `npm.cmd run dev` from the project folder.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    if (response.status >= 500) {
      throw new Error(data?.error || 'The API could not start a secure session. Check PostgreSQL and the API terminal.')
    }
    throw new Error(data?.error || 'Could not start a secure session. Please refresh and try again.')
  }
  const data = await response.json()
  csrfToken = data.csrfToken
}

export async function api(path, options = {}) {
  const method = options.method || 'GET'
  const headers = { ...options.headers }
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await refreshCsrf()
    headers['X-CSRF-Token'] = csrfToken
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
  })
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const data = contentType.includes('application/json') ? await response.json() : null
    const error = new Error(data?.error || 'Something went wrong. Please try again.')
    error.status = response.status
    error.details = data?.details || []
    throw error
  }
  return contentType.includes('application/json') ? response.json() : response.text()
}

export function downloadReport(path) {
  return api(path).then((text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'milk-report.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  })
}
