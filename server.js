import http from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataFile = path.join(root, 'data', 'content-bank.json')
const publicDir = path.join(root, 'public')
const uploadDir = path.join(root, 'uploads')
const resourcesFile = path.join(root, 'data', 'learning-resources.json')
const port = Number(process.env.PORT || 4317)
const host = '127.0.0.1'

const limits = { X: 280, LinkedIn: 3000 }
const bufferFreePlan = {
  maxChannels: 3,
  maxScheduledPostsPerChannel: 10,
  maxScheduledThreads: 1,
  maxIdeas: 100,
}
const sentLogFile = path.join(root, 'publishing-log.json')

async function getLocalEnv() {
  try {
    const raw = await readFile(path.join(root, '.env'), 'utf8')
    return Object.fromEntries(
      raw.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const separator = line.indexOf('=')
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
        }),
    )
  } catch {
    return {}
  }
}

async function bufferRequest(query, variables = {}) {
  const localEnv = await getLocalEnv()
  const apiKey = process.env.BUFFER_API_KEY || localEnv.BUFFER_API_KEY
  if (!apiKey) throw new Error('BUFFER_API_KEY is not configured locally')
  const result = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await result.json()
  if (!result.ok || payload.errors) {
    throw new Error(payload.errors?.map((error) => error.message).join('; ') || `Buffer API returned ${result.status}`)
  }
  return payload.data
}

async function readSentLog() {
  try { return JSON.parse(await readFile(sentLogFile, 'utf8')) } catch { return [] }
}

async function saveSentLog(log) {
  await writeFile(sentLogFile, `${JSON.stringify(log, null, 2)}\n`, 'utf8')
}

async function readPosts() {
  const posts = JSON.parse(await readFile(dataFile, 'utf8'))
  const resources = JSON.parse(await readFile(resourcesFile, 'utf8'))
  const sentLog = await readSentLog()
  const sentIds = new Set(sentLog.map((entry) => entry.localPostId))
  const metadataFallbacks = {
    'linkedin-w09-b': { title: 'OAuth tokens have lifecycle rules', source: 'backend/src/integrations/integrations.service.ts' },
    'linkedin-w10-a': { title: 'Typed API envelopes reduce frontend guesswork', source: 'NAVISHR-Dashboard/src/modules/performance/api/dashboard.api.ts' },
    'linkedin-w11-b': { title: 'Camera permissions need graceful failure', source: 'exam-player/src/features/student/exams/components/CameraModal.tsx' },
    'linkedin-w12-b': { title: 'The boring quality loop works', source: 'backend/agent.md' },
  }
  return posts.map((post) => {
    let next = { ...metadataFallbacks[post.id], ...post }
    if (sentIds.has(post.id)) {
      next.status = 'Sent'
    }
    if (post.platform === 'X' && post.format === 'thread' && post.items.length === 4) {
      next = { ...next, items: [post.items[0], post.items[1], `${post.items[2]} ${post.items[3]}`] }
    }
    if (next.platform === 'LinkedIn' && !next.hashtags) {
      const hashtags = next.source?.includes('exam-player')
        ? ['#EdTech', '#Assessment', '#ProductEngineering']
        : next.source?.includes('Dashboard')
          ? ['#FrontendDevelopment', '#TypeScript', '#ProductEngineering']
          : next.source?.includes('docs')
            ? ['#WorkflowAutomation', '#SoftwareEngineering', '#ProductDesign']
            : ['#SoftwareEngineering', '#BackendDevelopment', '#SaaS']
      next = { ...next, hashtags, items: next.items.map((text) => `${text}\n\n${hashtags.join(' ')}`) }
    }
    const text = `${next.title} ${next.source}`.toLowerCase()
    const resourceKey = text.includes('tenant') ? 'multi-tenant'
      : text.includes('permission') || text.includes('authorization') ? 'permissions'
        : text.includes('oauth') ? 'oauth'
          : text.includes('auth') || text.includes('token') ? 'authentication'
          : text.includes('transaction') ? 'transactions'
            : text.includes('state machine') || text.includes('workflow') || text.includes('approval') ? 'state-machine'
              : text.includes('timer') ? 'timers'
                  : text.includes('camera') || text.includes('microphone') || text.includes('fullscreen') ? 'browser-permissions'
                    : text.includes('exam') || text.includes('question') || text.includes('assessment') ? 'exam-design'
                    : text.includes('proctor') || text.includes('face') ? 'proctoring'
                      : text.includes('optimistic') || text.includes('drag') ? 'optimistic-ui'
                        : text.includes('pagination') || text.includes('list') ? 'pagination'
                          : text.includes('n+1') || text.includes('batched') ? 'n-plus-one'
                            : text.includes('cache') || text.includes('query key') ? 'caching'
                              : text.includes('audit') || text.includes('history') ? 'audit'
                                : text.includes('oauth') ? 'oauth'
                                  : text.includes('secret') || text.includes('security') ? 'security'
                                    : text.includes('test') || text.includes('quality') ? 'quality'
                                      : text.includes('type') || text.includes('typed') ? 'typescript'
                                        : text.includes('nestjs') || text.includes('backend') ? 'nestjs'
                                          : 'api-design'
    return {
      ...next,
      learning: {
        ...resources[resourceKey],
        resourceKey,
        codeReference: next.source,
        suggestedQuestion: `What is the main tradeoff in ${resources[resourceKey].concept.toLowerCase()}?`,
      },
    }
  })
}

async function savePosts(posts) {
  await writeFile(dataFile, `${JSON.stringify(posts, null, 2)}\n`, 'utf8')
}

function validatePost(post) {
  const limit = limits[post.platform]
  const counts = post.items.map((text) => text.length)
  const valid = post.platform === 'X'
    ? counts.every((count) => count <= limit) && post.items.every((text) => !text.includes('#'))
    : counts.every((count) => count <= limit)
  return { valid, limit, counts }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function parseBody(request) {
  let raw = ''
  for await (const chunk of request) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/resources' && request.method === 'GET') {
    const resources = JSON.parse(await readFile(resourcesFile, 'utf8'))
    return sendJson(response, 200, resources)
  }

  if (pathname === '/api/posts' && request.method === 'GET') {
    const posts = await readPosts()
    return sendJson(response, 200, {
      posts: posts.map((post) => ({ ...post, validation: validatePost(post) })),
      bufferPlan: bufferFreePlan,
    })
  }

  if (pathname === '/api/uploads' && request.method === 'POST') {
    const body = await parseBody(request)
    if (!body.filename || !body.dataUrl?.startsWith('data:')) {
      return sendJson(response, 400, { error: 'filename and dataUrl are required' })
    }
    const safeName = path.basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`)
    const base64 = body.dataUrl.split(',')[1]
    await mkdir(uploadDir, { recursive: true })
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return sendJson(response, 201, { filename: path.basename(filePath), path: `/uploads/${path.basename(filePath)}` })
  }

  if (pathname === '/api/buffer/status' && request.method === 'GET') {
    try {
      const account = await bufferRequest('query { account { organizations { id name } } }')
      const organizations = account.account.organizations ?? []
      const channels = []
      for (const organization of organizations) {
        const data = await bufferRequest(
          'query($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name service } }',
          { organizationId: organization.id },
        )
        channels.push(...(data.channels ?? []).map((channel) => ({ ...channel, organizationId: organization.id })))
      }
      return sendJson(response, 200, { connected: true, organizations, channels, bufferPlan: bufferFreePlan })
    } catch (error) {
      return sendJson(response, 502, { connected: false, error: error.message })
    }
  }

  if (pathname === '/api/buffer/send' && request.method === 'POST') {
    const body = await parseBody(request)
    const post = body.post
    if (!post || post.status !== 'Approved') return sendJson(response, 400, { error: 'Only approved posts can be sent' })
    const validation = validatePost(post)
    if (!validation.valid) return sendJson(response, 400, { error: 'Post fails platform validation', validation })

    const sentLog = await readSentLog()
    if (sentLog.some((entry) => entry.localPostId === post.id)) {
      return sendJson(response, 409, { error: 'This post has already been sent from this dashboard' })
    }
    if (post.format === 'thread' && sentLog.some((entry) => entry.isThread && entry.status === 'scheduled')) {
      return sendJson(response, 409, { error: 'Buffer Free plan allows only one scheduled thread at a time' })
    }

    try {
      const localEnv = await getLocalEnv()
      const channelId = body.channelId || (post.platform === 'X' ? localEnv.BUFFER_X_CHANNEL_ID : localEnv.BUFFER_LINKEDIN_CHANNEL_ID)
      if (!channelId) return sendJson(response, 400, { error: `No Buffer channel is configured for ${post.platform}` })
      const input = { text: post.items[0], channelId, schedulingType: 'automatic', mode: 'addToQueue' }
      if (post.format === 'thread') input.metadata = { twitter: { thread: post.items.map((text) => ({ text })) } }
      const data = await bufferRequest(
        'mutation($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } } }',
        { input },
      )
      if (!data.createPost.post) return sendJson(response, 502, { error: data.createPost.message || 'Buffer did not create the post' })
      const entry = { localPostId: post.id, bufferPostId: data.createPost.post.id, isThread: post.format === 'thread', status: data.createPost.post.status, dueAt: data.createPost.post.dueAt, sentAt: new Date().toISOString() }
      await saveSentLog([...sentLog, entry])
      return sendJson(response, 201, entry)
    } catch (error) {
      return sendJson(response, 502, { error: error.message })
    }
  }

  const match = pathname.match(/^\/api\/posts\/([^/]+)$/)
  if (match) {
    const id = decodeURIComponent(match[1])
    const posts = await readPosts()
    const index = posts.findIndex((post) => post.id === id)
    if (index < 0) return sendJson(response, 404, { error: 'Post not found' })

    if (request.method === 'PATCH') {
      const patch = await parseBody(request)
      const next = { ...posts[index], ...patch }
      if (!Array.isArray(next.items)) return sendJson(response, 400, { error: 'items must be an array' })
      posts[index] = next
      await savePosts(posts)
      if (patch.status === 'Draft') {
        const sentLog = await readSentLog()
        await saveSentLog(sentLog.filter((entry) => entry.localPostId !== id))
      }
      return sendJson(response, 200, { ...next, validation: validatePost(next) })
    }
  }

  if (pathname === '/api/buffer/preview' && request.method === 'POST') {
    const body = await parseBody(request)
    const post = body.post
    if (!post) return sendJson(response, 400, { error: 'post is required' })
    const validation = validatePost(post)
    return sendJson(response, 200, {
      action: 'preview-only',
      note: 'No Buffer mutation is performed by the review build. Free-plan capacity must be checked before sending.',
      bufferPlan: bufferFreePlan,
      payload: {
        channelId: '<configure locally>',
        schedulingType: 'automatic',
        mode: 'addToQueue',
        text: post.items[0],
        threadedPosts: post.format === 'thread' ? post.items.slice(1).map((text) => ({ text })) : []
      },
      validation
    })
  }

  return sendJson(response, 404, { error: 'API route not found' })
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const baseDir = requested.startsWith('/uploads/') ? uploadDir : publicDir
  const relativePath = requested.startsWith('/uploads/')
    ? requested.slice('/uploads/'.length)
    : requested.slice(1)
  const filePath = path.normalize(path.join(baseDir, relativePath))
  if (!filePath.startsWith(baseDir) || !existsSync(filePath)) {
    response.writeHead(404)
    return response.end('Not found')
  }
  const extension = path.extname(filePath)
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  response.writeHead(200, { 'Content-Type': `${types[extension] || 'text/plain'}; charset=utf-8` })
  response.end(await readFile(filePath))
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`)
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url.pathname)
    return await serveStatic(response, url.pathname)
  } catch (error) {
    console.error(error)
    sendJson(response, 500, { error: 'Internal server error' })
  }
})

server.listen(port, host, () => {
  console.log(`Private socials dashboard: http://${host}:${port}`)
})
