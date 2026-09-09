let resources = {};
let posts = [];

const $ = (selector) => document.querySelector(selector);

const PROGRESS_KEY = 'socials.masteredConcepts';

function loadProgress() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveProgress(mastered) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...mastered]));
  } catch {
    // localStorage unavailable (private mode, blocked storage) — progress just won't persist.
  }
}

let mastered = loadProgress();

async function init() {
  try {
    const resResponse = await fetch('./learning-resources.json');
    resources = await resResponse.json();

    try {
      const postsResponse = await fetch('/api/posts');
      if (postsResponse.ok) {
        const postsData = await postsResponse.json();
        posts = postsData.posts;
      }
    } catch (e) {
      console.log('Running in static mode (no local posts API available)');
    }

    render();
  } catch (error) {
    console.error('Failed to load learning resources:', error);
    $('#resourcesGrid').innerHTML = '<p class="meta">Error loading resources.</p>';
  }
}

function getLinkedPosts(key) {
  return posts.filter(post => post.learning && post.learning.resourceKey === key);
}

function renderStats() {
  const total = Object.keys(resources).length;
  const done = [...mastered].filter((key) => resources[key]).length;
  $('#stats').innerHTML = [
    [done, `of ${total} concepts mastered`],
    [total, 'total concepts'],
    [posts.length || '—', 'content bank posts'],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function toggleMastered(key) {
  if (mastered.has(key)) mastered.delete(key);
  else mastered.add(key);
  saveProgress(mastered);
  render();
}

function render() {
  renderStats();

  const query = $('#searchResource').value.toLowerCase();
  const grid = $('#resourcesGrid');

  const filteredKeys = Object.keys(resources).filter(key => {
    const resource = resources[key];
    const matchesSearch =
      key.toLowerCase().includes(query) ||
      resource.concept.toLowerCase().includes(query) ||
      (resource.learn && resource.learn.toLowerCase().includes(query)) ||
      (resource.officialLabel && resource.officialLabel.toLowerCase().includes(query)) ||
      (resource.youtubeLabel && resource.youtubeLabel.toLowerCase().includes(query));
    return matchesSearch;
  });

  if (!filteredKeys.length) {
    grid.innerHTML = '<p class="meta">No matching concepts found.</p>';
    return;
  }

  grid.innerHTML = filteredKeys.map(key => {
    const res = resources[key];
    const linked = getLinkedPosts(key);
    const isMastered = mastered.has(key);

    const postItemsHtml = linked.length
      ? `
        <div class="linked-posts">
          <strong>Review Posts (${linked.length})</strong>
          <ul>
            ${linked.map(p => `
              <li>
                <a href="/?post=${encodeURIComponent(p.id)}" title="${escapeHtml(p.title)}">
                  <b>W${p.week}D${p.day} (${p.platform})</b> · ${escapeHtml(p.title)}
                </a>
              </li>
            `).join('')}
          </ul>
        </div>
      `
      : '';

    const checklistHtml = res.checklist
      ? `<ul class="mastery-checklist">${res.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';

    return `
      <div class="resource-card ${isMastered ? 'mastered' : ''}">
        <div>
          <h3>${escapeHtml(res.concept)}</h3>
          <p class="resource-field"><b>Learn:</b> ${escapeHtml(res.learn)}</p>
          <p class="resource-field why"><b>Why it matters:</b> ${escapeHtml(res.why)}</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 14px;">
          ${checklistHtml ? `<div><strong class="section-label">You've got it when you can</strong>${checklistHtml}</div>` : ''}
          <div class="links">
            <a href="${escapeHtml(res.official)}" target="_blank" rel="noreferrer">
              📘 ${escapeHtml(res.officialLabel || 'Reference')}
            </a>
            ${res.youtube ? `
            <a href="${escapeHtml(res.youtube)}" target="_blank" rel="noreferrer">
              📺 ${escapeHtml(res.youtubeLabel || 'Video')}
            </a>` : ''}
          </div>
          ${postItemsHtml}
          <label class="mastered-toggle">
            <input type="checkbox" data-mastered-key="${escapeHtml(key)}" ${isMastered ? 'checked' : ''} />
            Mastered this concept
          </label>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('[data-mastered-key]').forEach((input) => {
    input.addEventListener('change', () => toggleMastered(input.dataset.masteredKey));
  });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

$('#searchResource').addEventListener('input', render);
init();
