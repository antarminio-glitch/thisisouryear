// Export direct links for each catalog-enabled garment and city.
// Usage: node scripts/export-order-links.mjs > order-links.csv
import fs from 'node:fs/promises';
import { orderPath } from '../src/lib/order-links.js';
const read = async name => JSON.parse(await fs.readFile(new URL(`../src/data/${name}.json`,import.meta.url)));
const [teams,catalog] = await Promise.all(['teams','catalog'].map(read));
const quote = value => `"${String(value).replaceAll('"','""')}"`;
console.log(['City','Garment','Existing city link','Focused order link (requires order page deployment)'].map(quote).join(','));
for (const city of teams) for (const product of catalog.products.filter(p=>p.sellable)) {
  const path=orderPath({slug:city.slug,...product});
  const query=new URL(path,'https://thisisouryear.team').searchParams;
  query.delete('city');
  const existing=`https://thisisouryear.team/${city.slug}/${query.size?'?'+query:''}#city`;
  console.log([city.name,product.audience==='adult'?`Adult ${product.name.toLowerCase()}`:product.name,existing,'https://thisisouryear.team'+path].map(quote).join(','));
}
