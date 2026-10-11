# Shirt artwork reference — October 11, 2026

The customer supplied IMG_3336 2.JPG as the layout reference. reference-v1 is a vector reconstruction, not an identification of the original font or an exact trace. Visual approval is pending.

Master: src/lib/varsity-artwork.js. Tall athletic slab lettering; equal-width lines; tight row spacing; top light fill over dark keyline and silver rim; bottom solid dark face with light keyline and silver rim. Letter shapes, tracking, row widths and placement are shared across city selections, cart, gifts, sets and share graphics. Keep geometry fixed when changing colors. Do not replace with browser-font text.

The master print rectangle is 236 units wide, 123 high (57 + 9 + 57), centered at x=300 in the 600-unit viewport. Its top edge on each garment's photo is set per garment in src/data/garments.json (`print`), since tees and hoodies are framed differently and hoodies must clear the pocket and drawstrings. These are mockup coordinates, not inches or a production print-size instruction. The printer must confirm physical size and distance below collar on the chosen blank.

Product images are SanMar front-flat photos of the blanks (PC54, PC78H, PC54Y, PC78YH), fetched by `npm run photos` (scripts/fetch-garment-photos.mjs), trimmed of their white margin, centered on a white square and saved as WebP. The blank color for each city is matched automatically to the city's shirt color, or named by hand with `blank` in teams.json. They are representative blank colors, not evidence of an exact reference-color match, final product selection or stock. src/data/garment-photos.json records the original page and image URL for every asset. Supplier media library: https://www.sanmar.com/marketing/medialibrary . Accessed October 11, 2026. No material, SKU, price or stock claims were changed.

Before launch: customer approval of this visual reconstruction, printer-approved size and color selections, and actual product specification. The separate sandbox/vendor-email issue in the handoff review is not fixed by these visual changes.
