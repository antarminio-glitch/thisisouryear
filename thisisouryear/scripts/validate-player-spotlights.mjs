import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const base=process.env.SITE_URL||'http://127.0.0.1:4324';
const out=process.env.PREVIEW_OUTPUT;
const read=async name=>JSON.parse(await fs.readFile(new URL(`../src/data/${name}.json`,import.meta.url)));
const [teams,selections]=await Promise.all(['teams','player-spotlights'].map(read));
const result={checks:0,cities:teams.length,errors:[]};
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  page.on('pageerror',e=>result.errors.push(e.message));
  const verify=async slug=>{
   const box=page.locator('[data-player-spotlight]');
   const entry=selections.entries[slug];
   assert.equal(await box.isVisible(),true);
   assert.equal(await box.locator('[data-player-name]').textContent(),entry.name);
   assert.equal(await box.locator('[data-player-source]').getAttribute('href'),entry.sourceUrl);
   assert.equal(await box.locator('img').count(),0);
   assert.match(await box.locator('[data-player-date]').textContent(),/2026-10-13/);
   assert.equal(await box.locator('[data-player-note]').isVisible(),!!entry.rosterNote);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,slug+' overflow');
   result.checks++;
  };
  for(const city of teams){
   await page.goto(`${base}/${city.slug}/`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
   for(const audience of ['adult','kids'])for(const style of ['tee','hoodie']){
    await page.locator(`[data-preview-style="${style}"][data-preview-fit="${audience}"]`).click();
    await verify(city.slug);
   }
  }
  await page.goto(base+'/',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-player-spotlight]').isVisible(),false);
  for(const city of teams){
   await page.locator(`input[name="home-city"][value="${city.slug}"]`).check();
   await verify(city.slug);
  }
  const wall=page.locator('[data-city-grid]');
  await page.locator('.cities details summary').click();
  assert.equal(await wall.locator('[data-city-player]').count(),32);
  await wall.locator('[data-grid-search]').fill('Lamb');
  assert.equal(await wall.locator('.grid>li:visible').count(),1);
  assert.equal(await wall.locator('.grid>li:visible').getAttribute('data-slug'),'dallas');
  await wall.locator('[data-grid-search]').fill('not-a-player');
  assert.equal(await wall.locator('[data-grid-empty]').isVisible(),true);
  await wall.locator('[data-grid-clear]').click();
  if(out){await fs.mkdir(out,{recursive:true});await page.screenshot({path:`${out}/homepage-stars-${width}.png`,fullPage:true});}
  for(const city of teams){
   await page.goto(`${base}/order/?city=${city.slug}`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
   await verify(city.slug);
  }
  for(const slug of ['dallas','cleveland','miami']){
   await page.goto(`${base}/${slug}/`,{waitUntil:'networkidle'});
   if(out)await page.locator('[data-picker]').screenshot({path:`${out}/${slug}-spotlight-${width}.png`});
  }
  await page.close();
 }
 assert.deepEqual(result.errors,[]);
 console.log(JSON.stringify(result,null,2));
 if(out)await fs.writeFile(out+'/validation.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
