/** Uygulamanin HTTP API'sine erisim. Butun istekler X-Internal-Key tasir. */

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const KEY = process.env.APP_INTERNAL_API_KEY || ''

async function request(method, path, body) {
  let response
  try {
    response = await fetch(`${APP_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': KEY,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(`Uygulamaya ulasilamadi (${APP_URL}). "npm run dev" calisiyor mu?`)
  }

  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Beklenmeyen yanit (${response.status}): ${text.slice(0, 200)}`)
  }

  if (!response.ok) throw new Error(data.error || `Istek basarisiz (${response.status})`)
  return data
}

module.exports = {
  APP_URL,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
}
