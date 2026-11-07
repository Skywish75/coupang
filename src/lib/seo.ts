// Shared bits for <head> metadata and schema.org JSON-LD.
export const SITE_NAME = '가격일기';

export function org(site: URL) {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: site.href,
    logo: new URL('/icons/logo-512.png', site).href,
  };
}

export function breadcrumb(site: URL, items: [name: string, path: string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: new URL(path, site).href,
    })),
  };
}
