// @ts-check
import { defineConfig } from 'astro/config';
import sitemap, { ChangeFreqEnum } from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.pandia.app',
  trailingSlash: 'never',
  // 301 old/renamed URLs to their new homes so previously-indexed pages don't 404.
  redirects: {
    '/docs/query': '/docs/search',
    '/docs/visualization': '/docs/views',
  },
  integrations: [
    sitemap({
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.7,
      filter: (page) =>
        !page.includes('/404') &&
        !page.includes('/docs/query') &&
        !page.includes('/docs/visualization'),
      serialize: (item) => {
        const ROOT = 'https://www.pandia.app/';
        if (item.url === ROOT || item.url === 'https://www.pandia.app') {
          item.url = ROOT;
          item.priority = 1.0;
          item.changefreq = ChangeFreqEnum.DAILY;
        } else {
          item.url = item.url.replace(/\/$/, '');
          if (item.url.includes('/docs')) item.priority = 0.8;
        }
        return item;
      },
    }),
  ],
  build: {
    assets: '_assets'
  }
});
