// Builds /sitemap.xml so search engines can find every city page.
import teams from '../data/teams.json';

export function GET({ site }) {
  const paths = [
    '/',
    ...teams.map((t) => `/${t.slug}/`),
    '/size-chart/',
    '/shipping-returns/',
    '/contact/',
    '/privacy/',
    '/terms/',
  ];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
