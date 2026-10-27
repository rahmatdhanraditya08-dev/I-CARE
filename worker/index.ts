interface AssetBinding {
  fetch(request: Request): Promise<Response>
}

export interface WorkerEnvironment {
  ASSETS: AssetBinding
  IC_USERNAME: string
  IC_PASSWORD: string
}

function equalSecret(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  let difference = actualBytes.length ^ expectedBytes.length
  const length = Math.max(actualBytes.length, expectedBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

function basicCredentials(header: string | null): [string, string] | null {
  if (!header?.startsWith('Basic ')) return null
  try {
    const binary = atob(header.slice(6))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes)
    const separator = decoded.indexOf(':')
    return separator > 0 ? [decoded.slice(0, separator), decoded.slice(separator + 1)] : null
  } catch {
    return null
  }
}

function unauthorized(): Response {
  return new Response('Autentikasi diperlukan.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="I-Care", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const worker = {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const credentials = basicCredentials(request.headers.get('Authorization'))
    if (!credentials || !environment.IC_USERNAME || !environment.IC_PASSWORD) return unauthorized()

    const [username, password] = credentials
    if (!equalSecret(username, environment.IC_USERNAME) || !equalSecret(password, environment.IC_PASSWORD)) {
      return unauthorized()
    }

    const response = await environment.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'private, no-store')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}

export { basicCredentials, equalSecret }
export default worker
