const state = { posts: [], bufferPlan: null, bufferStatus: null, selectedId: null, selectedIds: new Set(), filters: { platform: 'all', status: 'all', search: '' } }
const limits = { X: 280, LinkedIn: 3000 }

const $ = (selector) => document.querySelector(selector)

async function loadPosts() {
  const response = await fetch('/api/posts')
  const data = await response.json()
  state.posts = data.posts
  state.bufferPlan = data.bufferPlan
  
  const params = new URLSearchParams(window.location.search)
  const postId = params.get('post')
  if (postId) {
    state.selectedId = postId
  }
  
  render()
  
  if (postId) {
    setTimeout(() => {
      const el = document.querySelector(`.post-card.selected`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
  }
}

function filteredPosts() {
  return state.posts.filter((post) => {
    const matchesPlatform = state.filters.platform === 'all' || post.platform === state.filters.platform
    const matchesStatus = state.filters.status === 'all' || post.status === state.filters.status
    const query = state.filters.search.toLowerCase()
    const matchesSearch = !query || `${post.title} ${post.items.join(' ')}`.toLowerCase().includes(query)
    return matchesPlatform && matchesStatus && matchesSearch
  })
}

function renderStats() {
  const approved = state.posts.filter((post) => post.status === 'Approved').length
  const sent = state.posts.filter((post) => post.status === 'Sent').length
  const invalid = state.posts.filter((post) => !post.validation.valid).length
  $('#stats').innerHTML = [
    ['total', state.posts.length, 'publishing units'],
    ['approved', approved, 'approved for Buffer'],
    ['sent', sent, 'sent to Buffer'],
    ['drafts', state.posts.filter((post) => post.status === 'Draft').length, 'awaiting review'],
    ['invalid', invalid, 'need content fixes']
  ].map(([, value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('')
}

function renderList() {
  $('#postList').innerHTML = filteredPosts().map((post) => `
    <article class="post-card ${post.platform === 'X' ? 'x-card' : 'linkedin-card'} ${state.selectedId === post.id ? 'selected' : ''}">
      <div class="card-top"><label class="select-label"><input type="checkbox" class="post-select" data-select-id="${escapeHtml(post.id)}" ${state.selectedIds.has(post.id) ? 'checked' : ''} /> Select</label><span class="badge">${post.platform} · Week ${post.week} · Day ${post.day}</span><span class="status ${post.status}">${post.status}</span></div>
      <h2>${escapeHtml(post.title)}</h2>
      <div class="meta">${post.format === 'thread' ? `${post.items.length}-post thread` : 'Standalone post'} · ${post.validation.counts.join(' / ')} characters${post.mediaHint ? ' · image suggested' : ''}</div>
      <div class="card-preview">${post.platform === 'X' ? post.items.map((item, index) => `<p><b>${index + 1}</b>${escapeHtml(item)}</p>`).join('') : `<p>${escapeHtml(post.items[0])}</p>`}</div>
      <div class="card-actions"><button class="open-post" data-id="${escapeHtml(post.id)}">Review post</button>${post.status === 'Approved' ? `<button class="card-draft" data-draft-id="${escapeHtml(post.id)}">Move to Draft</button>` : ''}</div>
    </article>`).join('') || '<p class="meta">No posts match these filters.</p>'
  document.querySelectorAll('.open-post').forEach((button) => button.addEventListener('click', () => { state.selectedId = button.dataset.id; render() }))
  document.querySelectorAll('.card-draft').forEach((button) => button.addEventListener('click', () => setPostStatus(button.dataset.draftId, 'Draft')))
  document.querySelectorAll('.post-select').forEach((checkbox) => checkbox.addEventListener('change', (event) => {
    const id = event.target.dataset.selectId
    if (event.target.checked) state.selectedIds.add(id)
    else state.selectedIds.delete(id)
    updateSelectionControls()
  }))
}

function updateSelectionControls() {
  $('#selectionCount').textContent = state.selectedIds.size
}

async function approveSelected() {
  const ids = [...state.selectedIds]
  if (!ids.length) return alert('Select at least one post first.')
  await setSelectedStatus('Approved')
}

async function draftSelected() {
  const ids = [...state.selectedIds]
  if (!ids.length) return alert('Select at least one post first.')
  await setSelectedStatus('Draft')
}

async function sendSelected() {
  const selected = state.posts.filter((post) => state.selectedIds.has(post.id))
  const approved = selected.filter((post) => post.status === 'Approved')
  if (!approved.length) return alert('Select at least one approved post first.')
  if (!state.bufferStatus?.channels) return alert('Check the Buffer connection first.')

  const results = []
  for (const post of approved) {
    const service = post.platform === 'X' ? 'twitter' : 'linkedin'
    const channel = state.bufferStatus.channels.find((item) => item.service === service)
    if (!channel) {
      results.push({ id: post.id, ok: false, error: `No ${post.platform} channel found` })
      continue
    }
    const response = await fetch('/api/buffer/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post, channelId: channel.id })
    })
    const result = await response.json()
    results.push({ id: post.id, ok: response.ok, error: result.error })
  }
  const sent = results.filter((result) => result.ok).length
  const failed = results.length - sent
  alert(`Bulk send finished: ${sent} sent, ${failed} blocked or failed. Check Buffer for queue capacity.`)
  state.selectedIds.clear()
  render()
}

async function setSelectedStatus(status) {
  const ids = [...state.selectedIds]
  await Promise.all(ids.map((id) => fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  })))
  state.selectedIds.clear()
  await loadPosts()
}

async function setPostStatus(id, status) {
  await fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  })
  await loadPosts()
}

function renderEditor() {
  const post = state.posts.find((item) => item.id === state.selectedId)
  const editor = $('#editor')
  if (!post) { editor.className = 'editor empty'; editor.textContent = 'Select a post to review.'; return }
  const validation = post.validation
  const isSent = post.status === 'Sent'
  editor.className = 'editor'
  editor.innerHTML = `
    <div class="editor-top"><span class="badge">${post.platform} · Week ${post.week} · Day ${post.day}</span><span class="status ${post.status}">${post.status}</span></div>
    <h2>${escapeHtml(post.title)}</h2>
    <p class="meta">Source: ${escapeHtml(post.source)}</p>
    ${post.learning ? `<div class="learning-box"><strong>Learn this concept</strong><p>${escapeHtml(post.learning.concept)}</p><span>${escapeHtml(post.learning.suggestedQuestion)}</span><div class="learning-links"><a href="${escapeHtml(post.learning.official)}" target="_blank" rel="noreferrer">Official docs · ${escapeHtml(post.learning.officialLabel)}</a><a href="${escapeHtml(post.learning.youtube)}" target="_blank" rel="noreferrer">${escapeHtml(post.learning.youtubeLabel)}</a><span>Code reference: ${escapeHtml(post.learning.codeReference)}</span></div></div>` : ''}
    ${post.platform === 'LinkedIn' && post.hashtags ? `<div class="validation">Suggested LinkedIn hashtags: ${post.hashtags.join(' ')}</div>` : ''}
    ${post.platform === 'X' ? '<div class="validation">X rule: no hashtags. Add a verified mention only when the post directly discusses that account or project.</div>' : ''}
    ${post.mediaHint ? `<div class="validation">Image suggestion: ${escapeHtml(post.mediaHint)}${post.mediaRequired ? ' (recommended)' : ' (optional)'}</div>` : ''}
    <label>Upload image<input id="mediaUpload" type="file" accept="image/png,image/jpeg,image/webp" /></label>
    <div id="mediaStatus" class="meta">${post.mediaPath ? `Uploaded: ${escapeHtml(post.mediaPath)}` : 'No image uploaded yet.'}</div>
    <div id="items">${post.items.map((item, index) => `<label>${post.format === 'thread' ? `Thread post ${index + 1}` : 'Post'}<textarea data-index="${index}">${escapeHtml(item)}</textarea></label>`).join('')}</div>
    <div class="validation ${validation.valid ? '' : 'invalid'}">${validation.valid ? 'Ready for review.' : 'Fix the highlighted platform rules before approving.'} Character counts: ${validation.counts.join(', ')} / limit ${validation.limit}${post.platform === 'X' ? ' · hashtags are not allowed' : ''}</div>
    <div class="actions">
      <button class="approve" id="approve" ${isSent ? 'hidden' : ''}>Approve</button>
      <button class="reject" id="reject" ${isSent ? 'hidden' : ''}>Reject</button>
      <button class="secondary" id="unapprove">${isSent ? 'Reschedule (Move to Draft)' : 'Move to Draft'}</button>
      <button class="secondary" id="save" ${isSent ? 'hidden' : ''}>Save edits</button>
      <button class="secondary" id="preview">Preview Buffer payload</button>
      <button id="send" ${isSent ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>${isSent ? 'Sent' : 'Send approved post'}</button>
    </div>
    <pre class="preview" id="previewBox" hidden></pre>`
  $('#save').addEventListener('click', () => savePost(post, 'Draft'))
  $('#approve').addEventListener('click', () => savePost(post, 'Approved'))
  $('#reject').addEventListener('click', () => savePost(post, 'Rejected'))
  $('#unapprove').addEventListener('click', () => savePost(post, 'Draft'))
  $('#preview').addEventListener('click', () => previewPost(post))
  $('#send').addEventListener('click', () => sendPost(post))
  $('#mediaUpload').addEventListener('change', () => uploadMedia(post))
}

async function sendPost(post) {
  if (!state.bufferStatus?.channels) {
    alert('Check the Buffer connection first.')
    return
  }
  const service = post.platform === 'X' ? 'twitter' : 'linkedin'
  const channel = state.bufferStatus.channels.find((item) => item.service === service)
  if (!channel) {
    alert(`No ${post.platform} channel was found in Buffer.`)
    return
  }
  const response = await fetch('/api/buffer/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post, channelId: channel.id })
  })
  const result = await response.json()
  alert(response.ok ? `Sent to Buffer. Post ID: ${result.bufferPostId}` : result.error)
}

async function uploadMedia(post) {
  const input = $('#mediaUpload')
  const file = input.files?.[0]
  if (!file) return
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, dataUrl })
  })
  const uploaded = await response.json()
  if (!response.ok) return
  await fetch(`/api/posts/${encodeURIComponent(post.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaPath: uploaded.path })
  })
  const index = state.posts.findIndex((item) => item.id === post.id)
  state.posts[index] = { ...state.posts[index], mediaPath: uploaded.path }
  render()
}

async function savePost(post, status) {
  const items = [...document.querySelectorAll('#items textarea')].map((input) => input.value)
  const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, status }) })
  const saved = await response.json()
  const index = state.posts.findIndex((item) => item.id === post.id)
  state.posts[index] = saved
  render()
}

async function previewPost(post) {
  const items = [...document.querySelectorAll('#items textarea')].map((input) => input.value)
  const response = await fetch('/api/buffer/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post: { ...post, items } }) })
  const preview = await response.json()
  const box = $('#previewBox')
  box.hidden = false
  box.textContent = JSON.stringify(preview, null, 2)
}

function render() { renderStats(); renderList(); renderEditor(); updateSelectionControls() }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])) }

$('#platformFilter').addEventListener('change', (event) => { state.filters.platform = event.target.value; render() })
$('#statusFilter').addEventListener('change', (event) => { state.filters.status = event.target.value; render() })
$('#searchFilter').addEventListener('input', (event) => { state.filters.search = event.target.value; render() })
$('#selectVisible').addEventListener('click', () => { filteredPosts().forEach((post) => state.selectedIds.add(post.id)); render() })
$('#clearSelection').addEventListener('click', () => { state.selectedIds.clear(); render() })
$('#approveSelected').addEventListener('click', approveSelected)
$('#draftSelected').addEventListener('click', draftSelected)
$('#sendSelected').addEventListener('click', sendSelected)
$('#bufferCheck').addEventListener('click', async () => {
  const response = await fetch('/api/buffer/status')
  const result = await response.json()
  state.bufferStatus = result
  $('#bufferStatus').textContent = response.ok
    ? `Connected: ${result.channels.length} channels found`
    : `Not connected: ${result.error}`
  $('#channelPanel').innerHTML = response.ok
    ? `<strong>Active Buffer channels</strong>${result.channels.map((channel) => `<span class="channel-chip"><b>${escapeHtml(channel.name)}</b> · ${escapeHtml(channel.service)} · active</span>`).join('')}`
    : `<strong>Buffer channels unavailable</strong><span>${escapeHtml(result.error)}</span>`
})
loadPosts()
