# This Is Our Year

The store at thisisouryear.team. One tee, 32 city colorways, straight to Stripe checkout.

You don't need to be a developer to run this. Almost everything you'll ever want to change lives in two small files:

| To change... | Edit this file |
| --- | --- |
| A city's colors, name, or add a city | `src/data/teams.json` |
| Price, sizes, shipping, tax, contact email | `src/data/product.json` |

Save the file, push it to GitHub, and the live site updates itself in about a minute.

---

## The hard rules

This is unlicensed fan apparel. It works because it uses city names, colors, and a generic phrase, and nothing a league or team owns. Keep it that way everywhere, including file names, page titles, and Stripe:

- No team names or nicknames
- No logos, helmets, mascots, or anything that looks like one
- No league names or league event names. Say "pro football" or "football"
- No player names, numbers, or likenesses
- Product photos can't have team merchandise in the frame

The footer disclaimer is on every page. Leave it there.

---

## Run it on your computer

You need [Node.js](https://nodejs.org) version 22 or newer. Then, in this folder:

```
npm install
npm run dev
```

Open http://localhost:4321. The page refreshes by itself when you save a file. Stop it with Ctrl+C.

`npm run dev` shows the pages but the Buy button won't work, because checkout needs Netlify. To test the Buy button locally:

1. Copy `.env.example` to a new file named `.env`
2. Paste your Stripe **test** secret key after `STRIPE_SECRET_KEY=`
3. Run `npm run dev:checkout` and open http://localhost:8888

---

## Change a color

Open `src/data/teams.json`. Each city is one line:

```json
{"slug":"dallas","name":"Dallas","colors":"Navy / Silver","shirt":"#041E42","line1":"#FFFFFF","line2":"#041E42","outline":"#869397"}
```

| Field | What it does |
| --- | --- |
| `slug` | The web address. `dallas` lives at `/dallas/` |
| `name` | The city name customers see |
| `colors` | Plain-English color label. Also goes on the Stripe order so the printer knows what to print |
| `shirt` | Shirt color |
| `line1` | Fill color of "THIS IS" |
| `line2` | Fill color of "OUR YEAR" |
| `outline` | The outer outline on both lines |
| `aka` | Optional. Nearby places the search box should also match, like `["Texas","DFW"]` |
| `image` | Optional. A real product photo that replaces the drawn shirt (see below) |

Colors are hex codes. Change the code, save, done. The page background, text color, and button color for that city all work themselves out from these four colors, including flipping the text to dark on light backgrounds.

**Add a city:** copy a line, change the values, and make sure every line except the last one ends with a comma.

**Remove a city:** delete its line.

---

## Change the price, sizes, or shipping

Open `src/data/product.json`:

```json
{
  "name": "This Is Our Year Tee",
  "priceCents": 1999,
  "sizes": ["S", "M", "L", "XL", "2XL", "3XL"],
  "upchargeSizes": ["2XL", "3XL"],
  "upchargeCents": 200,
  "shippingCents": 499,
  "shippingLabel": "Standard shipping",
  "shipMinDays": 5,
  "shipMaxDays": 10,
  "maxQuantity": 10,
  "automaticTax": false,
  "contactEmail": "hello@thisisouryear.team"
}
```

Money is in cents, so `1999` is $19.99.

- **Price:** change `priceCents`. This one number sets the price on the site and what Stripe charges.
- **Big-size upcharge:** `upchargeSizes` are the sizes that cost extra and `upchargeCents` is how much. Set `upchargeCents` to `0` to charge one price for everything.
- **Sizes:** add or remove from `sizes`. If you add one, add its measurements in `src/pages/size-chart.astro` too.
- **Shipping:** `shippingCents` is the flat rate per order. Set it to `0` for free shipping. `shipMinDays` and `shipMaxDays` are the delivery estimate shown on the site and at checkout.
- **Sales tax:** off by default. To have Stripe calculate and collect it, set up Stripe Tax in your Stripe dashboard first (it needs your tax registrations), then change `automaticTax` to `true`.
- **Contact email:** `contactEmail` shows on the contact, shipping, privacy, terms, and thank-you pages.

The price can't be tampered with from the browser. The site only tells the server which city and which size. The server looks up the price here.

---

## Swap in a real product photo

When you have real photos, put them in `public/photos/` and add an `image` field to that city:

```json
{"slug":"dallas", ... ,"image":"/photos/dallas.jpg"}
```

That city shows the photo instead of the drawn shirt, on both the home page and its own page. Square photos work best. Keep the hard rules in mind: nothing in the frame but your shirt.

---

## Put it online

You do these once.

### 1. Put the code on GitHub

Create a new **private** repository on github.com, then in this folder:

```
git remote add origin https://github.com/YOUR-USERNAME/thisisouryear.git
git push -u origin main
```

### 2. Connect it to Netlify

1. Log in at netlify.com and choose **Add new project**, then **Import an existing project**
2. Pick GitHub and choose the repository
3. Leave the build settings alone. They're already set in `netlify.toml`
4. Click **Deploy**

From now on, every push to `main` updates the live site automatically.

### 3. Add your Stripe key

In Netlify, open the project, then **Project configuration > Environment variables**, and add:

| Key | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Your Stripe secret key. Use the **test** key (`sk_test_...`) first |
| `SITE_URL` | Leave this out for now. Add `https://thisisouryear.team` once the domain is connected |

Then go to **Deploys** and choose **Trigger deploy** so the site picks up the key.

Never paste a Stripe key into a file in this folder. Keys only go in Netlify (or your local `.env`, which git ignores).

### 4. Test a purchase

With the test key in place, open your Netlify address, pick a city, pick a size, and hit Buy. On the Stripe page use:

- Card number `4242 4242 4242 4242`
- Any future expiry date, any 3-digit CVC, any US address

You should land on the thank-you page. In your Stripe dashboard (with **Test mode** on), open **Payments** and click the payment. You'll see the city, colors, size, and the shipping address.

### 5. Point thisisouryear.team at Netlify

In Netlify, open **Domain management**, choose **Add a domain**, and enter `thisisouryear.team`. Netlify then shows you exactly which DNS records to add where you bought the domain. Add them, wait for it to verify (minutes to a few hours), and Netlify turns on HTTPS by itself.

Then add the `SITE_URL` variable from step 3 and trigger one more deploy.

### 6. Go live

1. Clear every `[CONFIRM]` flag (next section)
2. In Netlify, swap `STRIPE_SECRET_KEY` for your **live** key (`sk_live_...`) and trigger a deploy
3. Buy one shirt yourself with a real card to make sure it all works, then refund it in Stripe

---

## Before launch: clear the [CONFIRM] flags

Anything still waiting on you or the print vendor is marked with a yellow `[CONFIRM]` tag on the site. To find them all, search this folder for `Confirm />`. Fix the text next to each one, then delete the `<Confirm />` tag.

What's flagged right now:

- **City pages** (`src/pages/[slug].astro`): fabric, fit, print method, delivery time, shipping price
- **Size chart** (`src/pages/size-chart.astro`): the measurements are typical numbers for a standard tee, not your vendor's
- **Shipping and returns** (`src/pages/shipping-returns.astro`): shipping price, delivery time, the returns policy, the cancellation policy
- **Privacy** and **Terms**: starter text. Have someone qualified read both. Terms also needs who operates the shop and which state's law applies
- **Contact email**: `hello@thisisouryear.team` is a placeholder. Set up that mailbox or change it in `product.json`
- **Thank-you page** (`src/pages/success.astro`): delivery time and the contact email

---

## Filling orders

For now this is manual. Each paid order shows up in your Stripe dashboard under **Payments**. Click one and you'll see:

- The item, spelled out: `This Is Our Year Tee, Dallas, Navy / Silver, Size L`
- Quantity
- Shipping name and address
- The same details again under Metadata: `city`, `colors`, `size`

Send that to your print vendor. Stripe also emails you for each payment if you turn that on under your Stripe notification settings.

---

## What's in this folder

```
src/data/teams.json        the 32 cities and their colors
src/data/product.json      price, sizes, shipping, tax, contact email
src/pages/index.astro      home page
src/pages/[slug].astro     the city page (this one file makes all 32)
src/pages/                 the other pages: size chart, shipping, privacy, terms, contact, thank-you, canceled
src/components/Shirt.astro the shirt drawing that recolors itself
src/lib/colors.js          works out readable text and button colors for each city
src/styles/global.css      site-wide look
netlify/functions/         the checkout code that talks to Stripe
public/                    fonts, icon, and the image used when the site is shared
netlify.toml               tells Netlify how to build the site
```

## Not built yet

- Automatically emailing each paid order to the vendor
- Real product photos for every city
- A share image per city
- More products and a cart
