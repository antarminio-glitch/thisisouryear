# This Is Our Year

The store at thisisouryear.team. One design, 32 city colorways, a cart, Stripe checkout, and the pages around it: rival gifts, fantasy league orders, matching adult and kids sets, a share card for every city, a fan photo gallery, and an owner's screen for the season.

You don't need to be a developer to run this. Almost everything you'll ever change lives in a few small data files:

| To change... | Edit this file |
| --- | --- |
| A city's colors, name, or add a city | `src/data/teams.json` |
| What's for sale, prices, sizes, which designs | `src/data/catalog.json` |
| Shipping, tax, contact email, cart limits, switches | `src/data/store.json` |
| The "years since" counters | `src/data/history.json` |
| The story on each city page | `src/data/stories.json` |

Save the file, push it to GitHub, and the live site updates itself in about a minute.

The app lives in the `thisisouryear` folder of the repository. Every command below is run from inside that folder.

---

## The hard rules

This is unlicensed fan apparel. It works because it uses city names, colors, and a generic phrase, and nothing a league or team owns. Keep it that way everywhere, including file names, page titles, data files, commit messages and Stripe:

- No team names or nicknames
- No logos, helmets, mascots, or anything that looks like one
- No league names or league event names. Say "pro football" or "football", and "the big game"
- No player names, numbers, or likenesses
- Product photos can't have team merchandise in the frame

The footer disclaimer is on every page. Leave it there.

`npm run test:site` scans the whole project and the built site for those names and fails if it finds one. Run it before you push.

---

## Run it on your computer

You need [Node.js](https://nodejs.org) version 22 or newer. Then, in this folder:

```
npm install
npm run dev
```

Open http://localhost:4321. The page refreshes by itself when you save a file. Stop it with Ctrl+C.

`npm run dev` shows the pages, but anything that talks to the server (checkout, the cart's price check, quote requests, fan photos, the admin screen) won't work, because those need Netlify. To test those locally:

1. Copy `.env.example` to a new file named `.env`
2. Fill in the values you want to test with (at least `STRIPE_SECRET_KEY` with your Stripe **test** key, and `ADMIN_TOKEN` for the admin screen)
3. Run `npm run dev:checkout` and open http://localhost:8888

Saved things (orders, quotes, fan photos, season facts) are kept in a local store while that runs, and never touch the live site.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Pages only, with live reload |
| `npm run dev:checkout` | Pages plus the server functions, like the live site |
| `npm run check` | Checks the data files against each other |
| `npm run build` | Checks the data, then builds the site into `dist/` |
| `npm test` | Unit tests: catalog rules, cart, checkout, counters, campaigns, fan photos, admin |
| `npm run test:site` | Checks the built site: all 32 pages, titles, sitemap, search-engine data, and the naming rule |
| `npm run verify` | Build, then both test suites. Run this before you push |

---

## Change a color

Open `src/data/teams.json`. Each city is one entry:

```json
{"slug":"dallas","name":"Dallas","colors":"Navy / Silver","shirt":"#0C2340","line1":"#FFFFFF","line2":"#0C2340","outline":"#87909A","apply":{"shirt":"dallas-navy","line1":"dallas-white","line2":"dallas-navy","outline":"dallas-silver"}}
```

| Field | What it does |
| --- | --- |
| `slug` | The web address. `dallas` lives at `/dallas/` |
| `name` | The city name customers see |
| `colors` | Plain-English color label. Also goes on the Stripe order so the printer knows what to print |
| `shirt` | Garment color |
| `line1` | Fill color of the first line of lettering |
| `line2` | Fill color of the second line |
| `outline` | The outer outline on both lines |
| `apply` | Which color from the reference palette each surface uses. `null` means "a custom color I chose" |
| `aka` | Optional. Nearby places the search box should also match, like `["Texas","DFW"]` |
| `image` | Optional. A real product photo that replaces the drawn tee |

Colors are hex codes. Change the code, save, done. The page background, text color, and button color for that city all work themselves out from these four colors.

If a surface's hex doesn't match the palette color it points at in `apply`, the data check warns you. Either change the hex back, or set that surface's `apply` to `null` to say the custom color is on purpose.

### The color reference

`src/data/palettes.json` holds every reference color for every city: hex, RGB, Pantone reference (or `null` if there isn't one), ink type, and whether it's resolved. It's built from the private color reference file and its map, which live in your handoff folder and never in this repository:

```
node scripts/import-colors.mjs <path to the color reference .json> <path to Store_Color_Map.json>
```

The import copies hex values exactly. It never converts or guesses. Optional rows (metallics, uniform variants, unconfirmed candidates) are kept in the file but never used as a default color.

**Add a city:** copy an entry, change the values, give it a palette in the map file and run the import. **Remove a city:** delete its entry and its palette.

---

## What's for sale: `src/data/catalog.json`

```json
{
  "currency": "usd",
  "designs": [
    { "id": "this-is-our-year", "name": "This Is Our Year", "lines": ["THIS IS", "OUR YEAR"], "status": "live", "artworkVersion": "store-v1" },
    { "id": "wait-til-next-year", "name": "Wait 'Til Next Year", "lines": ["WAIT 'TIL", "NEXT YEAR"], "status": "concept", "artworkVersion": null }
  ],
  "products": [
    { "id": "adult-tee", "name": "Tee", "style": "tee", "audience": "adult", "sellable": true, "priceCents": 1999, "designs": ["this-is-our-year"], "fulfillment": { "provider": "manual", "providerProductId": null }, "sizeChart": "/size-chart/#adult-tee", "variants": [{ "size": "S", "extraCents": 0, "inStock": true, "providerVariantId": null }, ...] },
    { "id": "adult-hoodie", "name": "Hoodie", "style": "hoodie", "audience": "adult", "sellable": false, "priceCents": null, "designs": [], "variants": [], ... }
  ],
  "bulk": { "quoteRequests": true, "tiers": [] },
  "sets": { "discountCents": 0 }
}
```

Money is in cents, so `1999` is $19.99.

Right now only the adult tee is for sale. The hoodie, kids tee and kids hoodie are **preview only**: shoppers can see them in any city's colors, but can't add them to the cart, and no price is shown or published anywhere. The "Wait 'Til Next Year" design is a **concept**: it can be previewed and never bought.

To put a product on sale, fill in all of these, then set `sellable` to `true`:

- `priceCents`
- `variants` with the real sizes. `extraCents` is a per-size upcharge (the 2XL and 3XL tee are 200 more). `inStock: false` greys a size out
- `designs`: which designs it comes in. At least one must be `live`
- `fulfillment.provider`: `"manual"` if you forward orders by hand. If you use a print service, put its name here, its product ID in `providerProductId`, and each size's ID in `providerVariantId`. Those IDs ride along on every Stripe order line as `provider_variant_id`. Until then the line says `unmapped`
- `sizeChart`: where its measurements are. Add them to `src/pages/size-chart.astro`

To put a design on sale, set its `status` to `"live"`, give it an `artworkVersion` (any label for the approved artwork file), and add its `id` to the `designs` of each product it goes on. Only then can the elimination follow-up email link to it.

`npm run check` refuses a product marked sellable with something missing, so you can't half-launch one by accident.

**Bulk discounts:** `bulk.tiers` is empty, so the fantasy league page says plainly there's no discount and offers a quote request instead. Add tiers like `{ "minQuantity": 12, "percentOff": 10 }` once you've decided. Tiers are shown on the league page and noted on each quote request. Checkout never applies a discount by itself: you answer the quote and settle the price by hand.

**Matching sets:** `sets.discountCents` is 0, so a set is just both items at regular price, and the page says so.

---

## Settings: `src/data/store.json`

| Field | What it does |
| --- | --- |
| `contactEmail` | Shows on the contact, shipping, privacy, terms, fans and thank-you pages. `hello@thisisouryear.team` is a placeholder |
| `shippingCents`, `shippingLabel`, `shipMinDays`, `shipMaxDays` | Flat shipping per order and the delivery estimate. `0` is free shipping |
| `automaticTax` | Off. To collect sales tax, set up Stripe Tax in your Stripe dashboard first, then set this to `true` |
| `maxQuantity`, `maxCartLines` | The most of one item, and the most lines, in one order. Bigger league orders go through a quote request |
| `collectMarketingConsent` | Off. When `true`, Stripe's checkout asks shoppers whether they want marketing email. Nobody can ever get a campaign email without having ticked that box |
| `giftNotes` | Off. When `true`, the rival gift page shows a gift note box. Only turn it on if the vendor will actually include the note |
| `noteMaxLength`, `leagueNameMaxLength` | Limits for those two text boxes |
| `requireVendorApprovedColors` | Off. When `true`, a city can only be bought once its colors have a vendor-approved print selection in `palettes.json` |
| `timezone` | The store's timezone. Counters change over at midnight here |
| `hashtag` | Shown on share buttons and the fans page |

---

## The counters: `src/data/history.json`

Each city page says how long it's been. The facts come from this file and nowhere else:

```json
"dallas": { "state": "previous_winner", "lastWinDate": "1996-01-28", "lastWinSeason": 1995, "verified": true, "verifiedOn": "2026-10-10" }
"buffalo": { "state": "never_won", "verified": true, "verifiedOn": "2026-10-10" }
```

- `previous_winner` with a `lastWinDate` shows "It's been N years since [city] last won the big game"
- `never_won` shows "Still chasing that first big-game win"
- The latest champion shows "Let's run it back", and a recent winner shows "Still celebrating"
- Anything `unknown`, not `verified`, or with no record shows "Still believing. Still our year." and no number

`latestCompletedSeason` is the most recent champion, and `refreshBy` is the date after which **every** counter stops showing a number until someone updates this file. It's set to just before the next big game. After that game: update the champion, their `lastWinDate` and `lastWinSeason`, set every `verifiedOn` to today, push `refreshBy` a year out, and push.

The site rebuilds itself once a day (see `BUILD_HOOK_URL` below), and each page also re-checks the counter in the browser, so the number is never a day behind.

Dallas is the worked example: 29 years on January 27, 2026, 30 years on January 28, 2026, 30 on October 10, 2026.

---

## The pages

| Address | What it is |
| --- | --- |
| `/` | Home: picker, ways to shop, every city, fan strip |
| `/teams/` | Every city, searchable |
| `/[city]/` | One page per city (32). Picker locked to that city, story, counter, share card, structured data for search engines |
| `/shop/` | Filter by design, garment, fit and city. What's for sale comes straight from the catalog |
| `/gifts/rival-colors/` | Rival gift. "Their city" and "what they wear" are two separate choices, and the buyer's own city is a third |
| `/fantasy-leagues/` | One order in mixed sizes, or a quote request for a bigger batch |
| `/matching-sets/` | One adult item and one kids item in the same colors |
| `/bandwagon/` | Neutral list of every city. Shows only the survivors once the playoff picture is confirmed in the admin screen |
| `/fans/` | Approved fan photos, share cards for every city, the photo form, and "take my photo down" |
| `/cart/` | The cart. Prices and sizes are re-checked by the server every time it opens |
| `/admin/` | The owner's screen. Not linked anywhere, hidden from search engines, needs the admin password |
| `/size-chart/`, `/shipping-returns/`, `/contact/`, `/privacy/`, `/terms/` | The usual |
| `/og/[city]-[hash].png` | The share card pictures, drawn when the site is built |
| `/sitemap.xml`, `/robots.txt` | For search engines. The cart, admin and after-checkout pages are left out |

Old `/teams/[city]` addresses redirect to `/[city]/`.

---

## How orders work

The browser never sets a price. It sends which product, design, city, size, quantity and purchase mode, and the server looks everything up in the catalog. A made-up price from the browser is ignored, an item that isn't for sale is refused, and half a matching set is refused.

Every Stripe order line carries this metadata: `team_id`, `city`, `colors`, `colorway_version`, `design_id`, `artwork_version`, `product_id`, `product_style`, `audience`, `size`, `variant_key`, `provider_variant_id`, `fulfillment_provider`, `print_approval`, `purchase_mode`, and when they apply, `bundle_id` (matching sets), `league_order_id` and `league_name` (league orders), `recipient_team_id` and `gift_note` (rival gifts). The order itself carries `customer_favorite_team_id` if the shopper told us their own city, kept apart from what they bought.

**Filling orders** is manual for now. Each paid order shows in your Stripe dashboard under **Payments**, with the item spelled out and the metadata above. Send that to your print vendor.

If `STRIPE_WEBHOOK_SECRET` is set, every paid order is also recorded on the site (so campaigns know who bought what). Without it, nothing is recorded and campaigns have nobody to email.

---

## The admin screen

Open `/admin/` and enter the password you saved in Netlify as `ADMIN_TOKEN`. Five sections:

- **Setup**: reads the real settings and says exactly what isn't set up yet, by name. Start here
- **Season**: enter the round the season is in and each city's status, with where you checked it. Recording a loss changes nothing. A city only becomes "eliminated" when you say why (mathematically, or lost a playoff game) and cite a source. The bandwagon only shows survivors when the round is confirmed, recent, and all 32 cities have a confirmed status
- **Campaigns**: all five start switched off. Turning one on takes typing `ACTIVATE` and its name. Window campaigns (schedule release, Week 1) need real dates for that season. The elimination follow-up has a dry run that shows who would get the email and the exact words, and sends nothing
- **Quotes**: league quote requests, to answer by email and mark as answered or ordered
- **Fan photos**: approve, reject, remove, and a repost queue. Nothing shows on the site until you approve it. Reposting is only offered when the fan ticked the second box. The site never posts to social media by itself

Everything the admin screen changes is written to an audit log.

---

## Put it online

You do these once.

### 1. Connect the repository to Netlify

1. Log in at netlify.com and choose **Add new project**, then **Import an existing project**
2. Pick GitHub and choose the repository
3. Set **Base directory** to `thisisouryear`. Leave the other build settings alone, they come from `netlify.toml`
4. Click **Deploy**

From now on, every push to `main` updates the live site automatically.

### 2. Environment variables

In Netlify, open the project, then **Project configuration > Environment variables**. Add what you need. Each one is optional, and the admin screen's Setup section tells you what each missing one holds back.

| Key | What it does |
| --- | --- |
| `STRIPE_SECRET_KEY` | Your Stripe secret key. Use the **test** key (`sk_test_...`) first. Without it, checkout can't open |
| `SITE_URL` | `https://thisisouryear.team` once the domain is connected. Leave it out until then |
| `STRIPE_WEBHOOK_SECRET` | From Stripe: **Developers > Webhooks > Add endpoint**, address `https://thisisouryear.team/.netlify/functions/stripe-webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`. Records paid orders on the site |
| `ADMIN_TOKEN` | The admin password. 16 characters or more. Without it the admin screen is off |
| `BUILD_HOOK_URL` | From Netlify: **Build & deploy > Build hooks > Add build hook**. Lets the site rebuild itself every morning so counters stay right |
| `CAMPAIGNS_LIVE` | Must be exactly `true` before any campaign email can go out |
| `EMAIL_PROVIDER` | `resend` is the only service the site knows |
| `RESEND_API_KEY` | From resend.com |
| `EMAIL_FROM` | The address emails come from, on a domain verified at Resend |
| `EMAIL_POSTAL_ADDRESS` | Your mailing address. Marketing email has to show one |
| `UNSUBSCRIBE_SECRET` | Any long random string (16+). Signs the unsubscribe links |

After adding a variable, go to **Deploys** and choose **Trigger deploy**.

Never paste a key into a file in this folder. Keys only go in Netlify, or your local `.env`, which git ignores.

### 3. Test a purchase

With the test key in place, open your Netlify address, pick a city, pick a size, and hit Buy. On the Stripe page use card `4242 4242 4242 4242`, any future expiry, any CVC, any US address. You should land on the thank-you page, and the payment shows in your Stripe dashboard with **Test mode** on.

### 4. Point thisisouryear.team at Netlify

In Netlify, open **Domain management**, choose **Add a domain**, and enter `thisisouryear.team`. Add the DNS records it shows you where you bought the domain, wait for it to verify, and Netlify turns on HTTPS by itself. Then add `SITE_URL` and trigger one more deploy.

### 5. Go live

1. Clear every `[CONFIRM]` flag (next section)
2. In Netlify, swap `STRIPE_SECRET_KEY` for your **live** key (`sk_live_...`) and trigger a deploy
3. Buy one shirt yourself with a real card to make sure it all works, then refund it in Stripe

---

## Before launch: clear the [CONFIRM] flags

Anything still waiting on you or the print vendor is marked with a yellow `[CONFIRM]` tag on the site. To find them all, search this folder for `Confirm />`. Fix the text next to each one, then delete the `<Confirm />` tag.

- **City pages** (`src/pages/[slug].astro`): fabric, fit, print method, delivery time, shipping price
- **Size chart** (`src/pages/size-chart.astro`): the measurements are typical numbers for a standard tee, not your vendor's
- **Shipping and returns**: shipping price, delivery time, the returns policy, the cancellation policy
- **Privacy** and **Terms**: starter text. Have someone qualified read both. Terms also needs who operates the shop and which state's law applies
- **Contact email**: `hello@thisisouryear.team` is a placeholder. Set up that mailbox or change it in `store.json`
- **Thank-you page** (`src/pages/success.astro`): delivery time and the contact email

---

## What's in this folder

```
src/data/              the data files above
src/pages/             one file per page. [slug].astro makes all 32 city pages
src/components/        the picker, the garment drawing, the city grid
src/lib/               shared rules: catalog and cart rules, counters, colors, share cards, search-engine data
src/scripts/           what runs in the browser: picker, cart, admin screen
src/server/            what runs on Netlify: checkout, webhook, quotes, season, campaigns, email, fan photos, admin
src/styles/global.css  site-wide look
netlify/functions/     thin wrappers that Netlify runs. The logic is in src/server/
scripts/               the data check and the color import
tests/                 unit tests, and tests/site/ for the built site
public/                fonts, icon, and the image used when the site is shared
netlify.toml           tells Netlify how to build and serve the site
.env.example           every environment variable, blank
```

## Not built yet

- Sending each paid order to a print service automatically (orders are forwarded by hand from Stripe)
- Real product photos
- An email service other than Resend, and the Resend adapter hasn't been exercised against the real service
- Anything that posts to social media. The repost queue is a to-do list for a person
- Rate limiting on the public forms. Netlify's own limits apply
- Analytics. Events are collected on the page and go nowhere until a service is connected in `src/scripts/analytics.js`
