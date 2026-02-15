// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap, { ChangeFreqEnum } from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.pandia.app',
  integrations: [
    sitemap({
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.7,
      lastmod: new Date(),
      customPages: [
        'https://www.pandia.app/',
        'https://www.pandia.app/docs/',
        'https://www.pandia.app/docs/installation/',
        'https://www.pandia.app/docs/quick-start/',
        'https://www.pandia.app/docs/visualization/',
        'https://www.pandia.app/docs/editor/',
        'https://www.pandia.app/docs/compare/',
        'https://www.pandia.app/docs/import-export/',
        'https://www.pandia.app/docs/type-generation/',
        'https://www.pandia.app/docs/export/',
        'https://www.pandia.app/docs/query/',
        'https://www.pandia.app/docs/search/',
        'https://www.pandia.app/docs/repair/',
        'https://www.pandia.app/docs/themes/',
        'https://www.pandia.app/docs/shortcuts/',
        'https://www.pandia.app/docs/configuration/',
        'https://www.pandia.app/docs/troubleshooting/',
      ],
      filter: (page) => !page.includes('/404'),
      serialize: (item) => {
        // Set higher priority for main pages
        if (item.url === 'https://www.pandia.app/') {
          item.priority = 1.0;
          item.changefreq = ChangeFreqEnum.DAILY;
        } else if (item.url.includes('/docs/')) {
          item.priority = 0.8;
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  },
  build: {
    assets: '_assets'
  }
});
