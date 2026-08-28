let resources = {};
let posts = [];

const $ = (selector) => document.querySelector(selector);

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

function render() {
  const query = $('#searchResource').value.toLowerCase();
  const grid = $('#resourcesGrid');
  
  const filteredKeys = Object.keys(resources).filter(key => {
    const resource = resources[key];
    const matchesSearch = 
      key.toLowerCase().includes(query) ||
      resource.concept.toLowerCase().includes(query) ||
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
      
    return `
      <div class="resource-card">
        <div>
          <h3>${escapeHtml(res.concept)}</h3>
          <p>Key topic in B2B SaaS engineering. Study the official resources and review the matching dashboard posts to build muscle memory.</p>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 14px;">
          <div class="links">
            <a href="${escapeHtml(res.official)}" target="_blank" rel="noreferrer">
              📘 ${escapeHtml(res.officialLabel || 'Official Documentation')}
            </a>
            <a href="${escapeHtml(res.youtube)}" target="_blank" rel="noreferrer">
              📺 ${escapeHtml(res.youtubeLabel || 'YouTube Search')}
            </a>
          </div>
          ${postItemsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

$('#searchResource').addEventListener('input', render);
init();
