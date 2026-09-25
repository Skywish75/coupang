import { searchProducts } from './coupang.js';
import { generateArticle } from './gemini.js';
import { getFileContent, commitFiles } from './github.js';
import { getNextTopic, isAlreadyPosted, markPosted, addLog } from './state.js';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toFrontmatterString(value) {
  return String(value).replace(/"/g, "'");
}

async function pickUnpostedProduct(env, topic) {
  const products = await searchProducts(env, topic, 10);
  for (const product of products) {
    if (!(await isAlreadyPosted(env, String(product.productId)))) {
      return product;
    }
  }
  return null;
}

// One full cycle: pick a topic -> find an unposted product -> generate a
// deep link + article -> commit the new post and updated affiliate link map
// to GitHub in a single commit (which triggers the connected Cloudflare
// Workers Build automatically).
export async function runAutoPublish(env) {
  const topic = await getNextTopic(env);

  const selected = await pickUnpostedProduct(env, topic);
  if (!selected) {
    await addLog(env, { topic, status: 'skipped', reason: '새로 소개할 상품 없음' });
    return { status: 'skipped', topic };
  }

  // Products returned by the authenticated search API already carry our
  // own affiliate tag (lptag=...) in productUrl, so they work as-is —
  // running them back through the deeplink-conversion endpoint rejects
  // them with "url convert failed".
  const affiliateUrl = selected.productUrl;
  const body = await generateArticle(env, selected, topic);

  const today = new Date().toISOString().slice(0, 10);
  const productSlug = `${slugify(selected.productName)}-${selected.productId}`;
  const postSlug = `${today}-${slugify(topic)}-${selected.productId}`;

  const frontmatter = [
    '---',
    `title: "${toFrontmatterString(selected.productName)} 추천 및 후기"`,
    `description: "${toFrontmatterString(topic)} 관련 추천 상품 ${toFrontmatterString(selected.productName)}을(를) 소개합니다."`,
    `pubDate: ${today}`,
    `tags: ["${toFrontmatterString(topic)}"]`,
    'hasAffiliateLinks: true',
    'products:',
    `  - slug: ${productSlug}`,
    `    title: "${toFrontmatterString(selected.productName)}"`,
    `    price: "${Number(selected.productPrice).toLocaleString('ko-KR')}원"`,
    `    description: "${toFrontmatterString(topic)} 카테고리 추천 상품"`,
    `    image: "${toFrontmatterString(selected.productImage)}"`,
    '---',
    '',
  ].join('\n');

  const postContent = frontmatter + body + '\n';

  const linksRaw = await getFileContent(env, 'data/affiliateLinks.json');
  const links = JSON.parse(linksRaw);
  links[productSlug] = { url: affiliateUrl, name: selected.productName };

  await commitFiles(env, {
    message: `chore: auto-publish post for "${topic}" (${selected.productName})`,
    files: [
      { path: `src/content/blog/${postSlug}.md`, content: postContent },
      { path: 'data/affiliateLinks.json', content: JSON.stringify(links, null, 2) + '\n' },
    ],
  });

  await markPosted(env, String(selected.productId));
  await addLog(env, {
    topic,
    status: 'published',
    productName: selected.productName,
    postSlug,
  });

  return { status: 'published', topic, productName: selected.productName, postSlug };
}
