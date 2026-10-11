// Receives Stripe's signed "payment went through" messages and records the order.
//
// Needs STRIPE_WEBHOOK_SECRET (from the webhook you add in the Stripe
// dashboard) and STRIPE_SECRET_KEY. Without them it does nothing.
import Stripe from 'stripe';
import { makeWebhookHandler } from '../../src/server/orders.js';
import { blobStorage } from '../../src/server/storage.js';

export default makeWebhookHandler({ env: process.env, stripeFor: (key) => new Stripe(key), getStorage: blobStorage });
