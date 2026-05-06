const request = require('supertest')
const { spawn } = require('child_process')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../../../.env') })

let proc
let stdout = ''
let stderr = ''

beforeAll(async () => {
  proc = spawn('node', ['index.js'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, JWT_ACCESS_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh-secret' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  proc.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })

  const started = Date.now()
  while (Date.now() - started < 15000) {
    try {
      const res = await request('http://localhost:3001').get('/health')
      if (res.status === 200) return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  throw new Error(`queue-service did not become healthy\nstdout:\n${stdout}\nstderr:\n${stderr}`)
})

afterAll(() => {
  proc.kill()
})

describe('queue-service', () => {
  it('GET /health returns 200', async () => {
    const res = await request('http://localhost:3001').get('/health').catch(error => {
      throw new Error(`${error.message}\n${stderr}`)
    })
    expect(res.status).toBe(200)
  })
})
