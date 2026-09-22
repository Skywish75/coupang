const TOPICS_KEY = 'topics';
const CURSOR_KEY = 'topic-cursor';
const POSTED_KEY = 'posted-product-ids';
const LOGS_KEY = 'logs';

const DEFAULT_TOPICS = ['무선 이어폰', '캠핑 의자', '가습기', '주방 정리용품', '아기 물티슈'];

export async function getTopics(env) {
  const raw = await env.STATE.get(TOPICS_KEY);
  return raw ? JSON.parse(raw) : DEFAULT_TOPICS;
}

export async function setTopics(env, topics) {
  await env.STATE.put(TOPICS_KEY, JSON.stringify(topics));
}

// Round-robins through the topic list so every keyword gets covered in turn.
export async function getNextTopic(env) {
  const topics = await getTopics(env);
  if (topics.length === 0) {
    throw new Error('토픽 목록이 비어 있습니다');
  }
  const cursorRaw = await env.STATE.get(CURSOR_KEY);
  const cursor = cursorRaw ? Number(cursorRaw) : 0;
  const topic = topics[cursor % topics.length];
  await env.STATE.put(CURSOR_KEY, String(cursor + 1));
  return topic;
}

export async function isAlreadyPosted(env, productId) {
  const raw = await env.STATE.get(POSTED_KEY);
  const ids = raw ? JSON.parse(raw) : [];
  return ids.includes(productId);
}

export async function markPosted(env, productId) {
  const raw = await env.STATE.get(POSTED_KEY);
  const ids = raw ? JSON.parse(raw) : [];
  ids.push(productId);
  await env.STATE.put(POSTED_KEY, JSON.stringify(ids.slice(-500)));
}

export async function addLog(env, entry) {
  const raw = await env.STATE.get(LOGS_KEY);
  const logs = raw ? JSON.parse(raw) : [];
  logs.unshift({ ...entry, at: new Date().toISOString() });
  await env.STATE.put(LOGS_KEY, JSON.stringify(logs.slice(0, 50)));
}

export async function getLogs(env) {
  const raw = await env.STATE.get(LOGS_KEY);
  return raw ? JSON.parse(raw) : [];
}
