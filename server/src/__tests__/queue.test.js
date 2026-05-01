const request = require('supertest')
const { spawn } = require('child_process')
const path = require('path')

let proc

beforeAll(async () => {
  proc = spawn('node', ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, JWT_ACCESS_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh-secret' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  await new Promise(r => setTimeout(r, 3000))
})

afterAll(() => {
  proc.kill()
})

describe('queue-service', () => {
  it('GET /health returns 200', async () => {
    const res = await request('http://localhost:3002').get('/health')
    expect(res.status).toBe(200)
  })
})
