// Starts a Stripe Checkout session. The logic is in src/server/checkout.js.
//
// Needs these environment variables, set in Netlify (never in this repo):
//   STRIPE_SECRET_KEY   your Stripe secret key (test key first, live key later)
//   SITE_URL            optional, e.g. https://thisisouryear.team
import Stripe from 'stripe';
import { shop } from '../../src/server/shop.js';
import { makeCheckoutHandler } from '../../src/server/checkout.js';

export default makeCheckoutHandler({ shop, env: process.env, stripeFor: (key) => new Stripe(key) });
