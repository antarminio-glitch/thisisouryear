// Builds /sitemap.xml so search engines can find every page worth finding.
// The cart, the admin screen and the after-checkout pages are left out on
// purpose.
import teams from '../data/teams.json';

export const SITEMAP_PATHS = [
  '/',
  '/teams/',
  ...teams.map((t) => `/${t.slug}/`),
  '/shop/',
  '/gifts/rival-colors/',
  '/matching-sets/',
  '/fantasy-leagues/',
  '/bandwagon/',
  '/fans/',
  '/size-chart/',
  '/shipping-returns/',
  '/contact/',
  '/privacy/',
  '/terms/',
];

export function GET({ site }) {
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
