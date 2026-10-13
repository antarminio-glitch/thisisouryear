import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPath } from '../src/lib/order-links.js';

test('shared order links preserve garment choices and leave size to the buyer', () => {
  const link = orderPath({slug:'new-york-green',style:'hoodie',audience:'kids',designId:'wait-til-next-year',size:'M'});
  const url = new URL(link,'https://thisisouryear.team');
  assert.equal(url.pathname,'/order/');
  assert.equal(url.searchParams.get('city'),'new-york-green');
  assert.equal(url.searchParams.get('style'),'hoodie');
  assert.equal(url.searchParams.get('fit'),'kids');
  assert.equal(url.searchParams.get('design'),'wait-til-next-year');
  assert.equal(url.searchParams.has('size'),false);
  assert.equal(orderPath({slug:'dallas'}),'/order/?city=dallas');
});
