import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const base=process.env.SITE_URL||'http://127.0.0.1:4323';
const out=process.env.PREVIEW_OUTPUT;
const read=async n=>JSON.parse(await fs.readFile(new URL(`../src/data/${n}.json`,import.meta.url)));
const [teams,catalog,store]=await Promise.all(['teams','catalog','store'].map(read));
const results={checks:0,errors:[]};
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  page.on('pageerror',e=>results.errors.push(e.message));
  const captured=[];
  // Never contact payment services during validation.
  await page.route('**/.netlify/functions/create-checkout',async route=>{
   captured.push(route.request().postDataJSON());
   await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Simulated checkout failure"}'});
  });
  for(const city of teams) {
   await page.goto(`${base}/order/?city=${city.slug}&utm_source=test&utm_campaign=city_launch`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-picker]')?.dataset.ready==='true');
   assert.equal(await page.locator('[data-city-details]').getAttribute('open'),null);
   for(const product of catalog.products) {
    await page.locator(`[data-preview-style="${product.style}"][data-preview-fit="${product.audience}"]`).click();
    if(!product.sellable) {
     assert.equal(await page.locator('[data-buy]').isDisabled(),true);
     assert.equal(await page.locator('[data-quick-checkout]').isVisible(),false);
     assert.equal(await page.locator('[data-order-total]').isVisible(),false);
     results.checks++;continue;
    }
    const variant=product.variants.find(v=>v.inStock);
    await page.locator(`input[name="order-size"][value="${variant.size}"]`).check();
    const expected=((product.priceCents+(variant.extraCents||0)+store.shippingCents)/100).toFixed(2);
    assert.match(await page.locator('[data-order-total]').textContent(),new RegExp(expected.replace('.','\\.')));
    assert.equal(await page.locator('[data-buy]').isDisabled(),false);
    assert.equal(await page.locator('[data-quick-checkout]').isVisible(),width<860);
    assert.equal(new URL(page.url()).searchParams.get('utm_source'),'test');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    results.checks++;
   }
  }
  // Missing size never presents an active mobile checkout bar.
  await page.goto(base+'/order/?city=unknown',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-city-details]').getAttribute('open'),'');
  await page.locator('input[name="order-city"][value="dallas"]').check();
  assert.equal(await page.locator('[data-city-details]').getAttribute('open'),null);
  await page.locator('[data-city-change]').click();
  await page.locator('input[name="order-city"][value="miami"]').check();
  assert.match(await page.locator('[data-summary]').textContent(),/Miami/);
  await page.goto(base+'/order/?city=dallas',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-quick-checkout]').isVisible(),false);
  await page.locator('input[name="order-size"][value="3XL"]').check();
  assert.match(await page.locator('[data-order-total]').textContent(),/26\.98/);
  // On mobile this must use the same validated request as the normal Buy now.
  await page.locator(width<860?'[data-quick-buy]':'[data-buy]').click();
  await page.waitForFunction(()=>document.querySelector('[data-msg]')?.textContent.includes("Checkout didn't open"));
  assert.deepEqual(captured[0],{slug:'dallas',size:'3XL'});
  assert.equal(await page.locator('[data-buy]').isDisabled(),false);
  if(width<860)assert.equal(await page.locator('[data-quick-buy]').isDisabled(),false);
  // Share fallback uses the focused link, without someone else's size.
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}}));
  await page.locator('[data-copy-order]').click();
  const share=await page.locator('[data-order-link]').inputValue();
  assert.equal(new URL(share).searchParams.get('city'),'dallas');
  assert.equal(new URL(share).searchParams.has('size'),false);
  await page.locator('[data-add]').click();
  assert.equal(await page.locator('[data-extra-item]').isVisible(),true);
  assert.equal(await page.locator('[data-matching]').getAttribute('href'),'/matching-sets/?city=dallas');
  if(out){await fs.mkdir(out,{recursive:true});await page.screenshot({path:`${out}/order-${width}.png`,fullPage:true});}
  await page.goto(base+'/?city=miami',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-buy]').count(),1);
  if(out)await page.screenshot({path:`${out}/homepage-${width}.png`,fullPage:true});
  await page.close();
 }
 assert.deepEqual(results.errors,[]);
 console.log(JSON.stringify(results,null,2));
 if(out)await fs.writeFile(out+'/checkout-validation.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
