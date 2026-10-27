import { describe, expect, it } from 'vitest'
import worker, { basicCredentials, equalSecret, type WorkerEnvironment } from '../worker/index'

const environment = (username = 'icare-demo', password = 'local-test-password'): WorkerEnvironment => ({
  IC_USERNAME: username,
  IC_PASSWORD: password,
  ASSETS: { fetch: async () => new Response('dashboard') },
})

const requestWith = (authorization?: string) => new Request('https://icare.example/', {
  headers: authorization ? { Authorization: authorization } : undefined,
})

describe('Worker Basic Auth', () => {
  it('rejects requests without credentials and challenges the browser', async () => {
    const response = await worker.fetch(requestWith(), environment())
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Basic realm="I-Care"')
  })

  it('serves assets only after valid credentials', async () => {
    const bad = await worker.fetch(requestWith(`Basic ${btoa('icare-demo:wrong')}`), environment())
    const good = await worker.fetch(requestWith(`Basic ${btoa('icare-demo:local-test-password')}`), environment())
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
    expect(await good.text()).toBe('dashboard')
    expect(good.headers.get('cache-control')).toBe('private, no-store')
  })

  it('parses malformed headers safely and compares full secret values', () => {
    expect(basicCredentials('Basic !!!')).toBeNull()
    expect(equalSecret('short', 'longer')).toBe(false)
    expect(equalSecret('identical', 'identical')).toBe(true)
  })
})
