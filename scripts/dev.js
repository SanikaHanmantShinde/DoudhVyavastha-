import 'dotenv/config'
import { spawn } from 'node:child_process'
import process from 'node:process'

const port = process.env.PORT || '3000'
const healthUrl = `http://127.0.0.1:${port}/api/health`
const children = new Set()
let stopping = false

function start(args, label) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  children.add(child)
  child.once('error', (error) => {
    console.error(`${label} could not start: ${error.message}`)
    process.exitCode = 1
    shutdown()
  })
  child.once('close', (code, signal) => {
    children.delete(child)
    if (stopping) return
    console.error(`${label} stopped${signal ? ` after ${signal}` : ` with exit code ${code}`}.`)
    process.exitCode = code || 1
    shutdown()
  })
  return child
}

async function waitForApi(child) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('The API server exited before becoming ready.')
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
      console.error(`API readiness check returned HTTP ${response.status}; waiting for the database connection.`)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`The API did not become ready at ${healthUrl}. Check PostgreSQL and .env configuration.`)
}

function shutdown() {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

try {
  let response
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) })
  } catch {
    response = null
  }

  if (response?.ok) {
    console.log(`Using the API server already available at http://127.0.0.1:${port}.`)
  } else {
    const api = start(['--watch-path=server', 'server/index.js'], 'API server')
    console.log(`Starting API server on port ${port} (watching server files only)…`)
    await waitForApi(api)
  }

  if (!stopping) {
    console.log('Starting Vite. Press Ctrl+C to stop the development services.')
    start(['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], 'Vite')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
  shutdown()
}

if (children.size) {
  await new Promise((resolve) => {
    const check = () => {
      if (children.size === 0) resolve()
    }
    for (const child of children) child.once('close', check)
    check()
  })
}
