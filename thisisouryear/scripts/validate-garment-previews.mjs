// Run against a built/served site. PLAYWRIGHT_MODULE and CHROME_PATH allow a
// shared browser runtime without adding a production dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { photoFor } from '../src/lib/photos.js';
const read = async name => JSON.parse(await fs.readFile(new URL(`../src/data/${name}.json`, import.meta.url)));
const [teams, catalog, photos] = await Promise.all(['teams', 'catalog', 'garment-photos'].map(read));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
const base = process.env.SITE_URL || 'http://127.0.0.1:4321';
const output = process.env.PREVIEW_OUTPUT;
if (output) await fs.mkdir(output, {recursive:true});
const results = {base, checks:0, cities:teams.length, errors:[], screenshots:[]};
try {
 for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  const page = await browser.newPage({viewport});
  page.on('pageerror', e => results.errors.push(e.message));
  const go = async route => {await page.goto(base+route, {waitUntil:'domcontentloaded'});};
  const verify = async (holder, product, city) => {
    const expected = photoFor(photos,product.id,city.slug);
    assert.equal(await holder.locator('svg image').getAttribute('href'),expected.src,`${city.slug}/${product.id}`);
    assert.match(await holder.locator('.garment-caption').textContent(),new RegExp(expected.color));
    assert.equal(await holder.locator('.varsity-artwork').count(),1);
    results.checks++;
  };
  const shot = async name => {if(output){await page.screenshot({path:`${output}/${name}.png`,fullPage:true});results.screenshots.push(name+'.png');}};
  // Each city page, each fit/style, both direct controls and thumbnail switching.
  for(const city of teams) {
    await go(`/${city.slug}/`);
    const root=page.locator('[data-picker]');
    await root.locator('[data-preview-style]').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
    for(const product of catalog.products) {
      await root.locator(`[data-preview-style="${product.style}"][data-preview-fit="${product.audience}"]`).click();
      await verify(root.locator('[data-garment]'),product,city);
      assert.equal(await root.locator(`[data-preview-style="${product.style}"][data-preview-fit="${product.audience}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await root.locator(`input[name="city-style"]:checked`).inputValue(),product.style);
      assert.equal(await root.locator(`input[name="city-fit"]:checked`).inputValue(),product.audience);
      if(!product.sellable) assert.equal(await root.locator('[data-add]').isDisabled(),true);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${city.slug}: horizontal overflow`);
    if(['dallas','philadelphia','miami'].includes(city.slug)) await shot(`${city.slug}-${viewport.width}`);
  }
  // URL state and browser back restore both preview and selection.
  await go('/dallas/?style=hoodie&fit=kids');
  await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
  await verify(page.locator('[data-garment]'),catalog.products.find(p=>p.id==='kids-hoodie'),teams.find(t=>t.slug==='dallas'));
  await page.locator('[data-preview-style="tee"][data-preview-fit="adult"]').click();
  await page.goBack();
  await verify(page.locator('[data-garment]'),catalog.products.find(p=>p.id==='kids-hoodie'),teams.find(t=>t.slug==='dallas'));
  // Homepage switching city must repaint all four thumbnails, not retain Dallas.
  await go('/');
  await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
  assert.equal(await page.locator('[data-garment-options]').isVisible(),false);
  for(const city of teams) {
    await page.locator(`input[name="home-city"][value="${city.slug}"]`).check();
    for(const product of catalog.products) {
      const button=page.locator(`[data-preview-style="${product.style}"][data-preview-fit="${product.audience}"]`);
      assert.equal(await button.locator('image').getAttribute('href'),photoFor(photos,product.id,city.slug).src);
      await button.click();
      await verify(page.locator('[data-garment]'),product,city);
    }
  }
  await shot(`home-${viewport.width}`);
  await go('/gifts/rival-colors/');
  await page.locator('[data-them]').selectOption('dallas');
  for(const city of teams) {
    await page.locator('[data-wear]').selectOption(city.slug);
    for(const product of catalog.products) {
      await page.locator(`input[name="gift-style"][value="${product.style}"]`).check();
      await page.locator(`input[name="gift-fit"][value="${product.audience}"]`).check();
      await verify(page.locator('[data-garment]'),product,city);
    }
  }
  await shot(`gifts-${viewport.width}`);
  await go('/matching-sets/');
  for(const city of teams) {
    await page.locator('select[data-city]').selectOption(city.slug);
    for(const product of catalog.products) {
      await page.locator(`input[name="set-${product.audience}-style"][value="${product.style}"]`).check();
      await verify(page.locator(`[data-half="${product.audience}"] [data-garment]`),product,city);
      if(!product.sellable) assert.equal(await page.locator('[data-add-set]').isDisabled(),true);
    }
  }
  await shot(`sets-${viewport.width}`);
  await go('/shop/');
  for(const city of teams) {
    await page.locator('[data-f="city"]').selectOption(city.slug);
    for(const product of catalog.products) {
      await page.locator('[data-f="style"]').selectOption(product.style);
      await page.locator('[data-f="fit"]').selectOption(product.audience);
      const tile=page.locator('[data-results]');
      await verify(tile,product,city);
      if(!product.sellable) assert.match(await tile.textContent(),/Preview only/);
    }
  }
  await shot(`shop-${viewport.width}`);
  await page.close();
 }
 // Check every unique image can actually be served, not just referenced.
 const page=await browser.newPage();
 const sources=new Set(Object.values(photos.garments).flatMap(g=>Object.values(g.colors).map(c=>c.src)));
 for(const src of sources) {const response=await page.request.get(base+src);assert.equal(response.status(),200,src);results.checks++;}
 assert.deepEqual(results.errors,[]);
 console.log(JSON.stringify(results,null,2));
 if(output) await fs.writeFile(`${output}/validation.json`,JSON.stringify(results,null,2));
} finally {await browser.close();}
