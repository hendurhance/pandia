// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap, { ChangeFreqEnum } from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://pandia.app',
  integrations: [
    sitemap({
      changefreq: ChangeFreqEnum.WEEKLY,
      priority: 0.7,
      lastmod: new Date(),
      customPages: [
        'https://pandia.app/',
        'https://pandia.app/docs/',
        'https://pandia.app/docs/installation/',
        'https://pandia.app/docs/quick-start/',
        'https://pandia.app/docs/visualization/',
        'https://pandia.app/docs/editor/',
        'https://pandia.app/docs/compare/',
        'https://pandia.app/docs/import-export/',
        'https://pandia.app/docs/type-generation/',
        'https://pandia.app/docs/export/',
        'https://pandia.app/docs/query/',
        'https://pandia.app/docs/search/',
        'https://pandia.app/docs/repair/',
        'https://pandia.app/docs/themes/',
        'https://pandia.app/docs/shortcuts/',
        'https://pandia.app/docs/configuration/',
        'https://pandia.app/docs/troubleshooting/',
      ],
      filter: (page) => !page.includes('/404'),
      serialize: (item) => {
        // Set higher priority for main pages
        if (item.url === 'https://pandia.app/') {
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
