import { defineConfig } from 'astro/config';

// Static site: every page is built ahead of time into plain HTML.
export default defineConfig({
  site: 'https://thisisouryear.team',
  trailingSlash: 'always',
  // Keeps spaces between words that sit next to links and tags.
  compressHTML: true,
});
