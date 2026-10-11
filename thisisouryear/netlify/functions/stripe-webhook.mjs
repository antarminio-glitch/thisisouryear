// Receives Stripe's signed "payment went through" messages, records the
// order, and emails it to the print vendor.
//
// Needs STRIPE_WEBHOOK_SECRET (from the webhook you add in the Stripe
// dashboard) and STRIPE_SECRET_KEY. Without them it does nothing.
// The vendor email also needs ORDER_EMAIL_TO and the email settings. See
// src/server/order-email.js.
import Stripe from 'stripe';
import { makeWebhookHandler } from '../../src/server/orders.js';
import { blobStorage } from '../../src/server/storage.js';
import { shop, palettes } from '../../src/server/shop.js';

export default makeWebhookHandler({ env: process.env, stripeFor: (key) => new Stripe(key), getStorage: blobStorage, shop, palettes });
