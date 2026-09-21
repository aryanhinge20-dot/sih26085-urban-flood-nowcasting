// Run recovery for serverless hosting: a follow-up request that lands on an instance without the run is answered
// 404 {code: "run_not_found"}; the client re-runs the same simulation ONCE and retries with the new run_id.
import test from 'node:test'
import assert from 'node:assert/strict'

const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body })

test('a run missing on this instance is re-run once and the request retried', async () => {
  const calls = []
  let simulations = 0
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`)
    if (url === '/api/simulate') return json(200, { run_id: `run-${++simulations}` })
    if (url.includes('run-1')) return json(404, { detail: { code: 'run_not_found', run_id: 'run-1' } })
    return json(200, { ok: true, url })
  }
  const api = await import('./client.js')
  const run = await api.simulate({ scenarioId: 'cloudburst' })
  assert.equal(run.run_id, 'run-1')
  const [a, b] = await Promise.all([api.getFrame('run-1', 60), api.getSeries('run-1')])
  assert.equal(a.url, '/api/simulation/run-2/frame/60')
  assert.equal(b.url, '/api/simulation/run-2/series')
  assert.equal(simulations, 2)                                   // one re-run shared by both callers
  await api.getFrame('run-1', 90)                                // later calls go straight to the new run
  assert.equal(simulations, 2)
  assert.equal(calls.at(-1), 'GET /api/simulation/run-2/frame/90')
})

test('other 404s are not treated as a missing run', async () => {
  globalThis.fetch = async () => json(404, { detail: 'unknown seg_id' })
  const api = await import('./client.js')
  await assert.rejects(api.explainSegment('run-x', 'seg', 0), /unknown seg_id/)
})
