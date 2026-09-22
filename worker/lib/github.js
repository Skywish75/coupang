const API_HOST = 'https://api.github.com';

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'coupang-auto-publisher',
  };
}

async function ghFetch(env, path, options = {}) {
  const res = await fetch(`${API_HOST}${path}`, {
    ...options,
    headers: { ...ghHeaders(env), ...(options.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function getFileContent(env, path) {
  const branch = env.GITHUB_BRANCH || 'main';
  const data = await ghFetch(env, `/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`);
  return atob(data.content.replace(/\n/g, ''));
}

// Commits one or more files in a single atomic commit via the Git Data API,
// so a post markdown file and the affiliateLinks.json update land together.
export async function commitFiles(env, { message, files }) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const ref = await ghFetch(env, `/repos/${repo}/git/ref/heads/${branch}`);
  const latestCommitSha = ref.object.sha;

  const latestCommit = await ghFetch(env, `/repos/${repo}/git/commits/${latestCommitSha}`);
  const baseTreeSha = latestCommit.tree.sha;

  const tree = [];
  for (const file of files) {
    const blob = await ghFetch(env, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await ghFetch(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });

  const newCommit = await ghFetch(env, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [latestCommitSha] }),
  });

  await ghFetch(env, `/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return newCommit.sha;
}
