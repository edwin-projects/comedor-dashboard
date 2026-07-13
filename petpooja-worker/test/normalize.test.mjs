// Fixtures are the actual sample payloads from Pet Pooja's two PDFs
// (Global API / webhook push, and Get Orders / pull). If these pass, the
// normalizer handles both real payload shapes and the rollup math is correct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrder, rollupDay } from '../src/normalize.js';

// ── PUSH payloads (Global API webhook) ──────────────────────────────────────
const pushBasic = { token: '', event: 'orderdetails', properties: {
  Restaurant: { restID: 'cp81ghin' },
  Order: { orderID: 114, order_type: 'Dine In', payment_type: 'Cash',
    discount_total: 0, tax_total: 0, core_total: 1158, total: 1158,
    created_on: '2025-04-04 11:45:35', order_from: 'POS', status: 'Success' },
  OrderItem: [
    { name: 'Chicken Drumstick Spicy (3 Pieces)', itemid: 136978202, category_name: 'Chicken Meal', price: 359, quantity: 1, total: 359, discount: 0, tax: 0 },
    { name: 'Chicken Tangdi', itemid: 1271458978, category_name: 'Chicken Meal', price: 390, quantity: 1, total: 390, discount: 0, tax: 0 },
    { name: 'Chicken Fillet Nuggets Meal (8 Pieces)', itemid: 136978193, category_name: 'Chicken Meal', price: 409, quantity: 1, total: 409, discount: 0, tax: 0 },
  ] } };

const pushDiscount = { properties: {
  Restaurant: { restID: 'cp81ghin' },
  Order: { orderID: 115, order_type: 'Dine In', payment_type: 'Card',
    discount_total: 253.4, tax_total: 0, core_total: 1267, total: 1034,
    created_on: '2025-04-04 11:49:20', order_from: 'POS', status: 'Success' },
  OrderItem: [ { name: 'Chicken Tikka (3 Pieces)', itemid: 136978234, category_name: 'Chicken', price: 100, quantity: 1, total: 100, discount: 20, tax: 0 } ] } };

const pushPartPay = { properties: {
  Restaurant: { restID: 'cp81ghin' },
  Order: { orderID: 116, order_type: 'Dine In', payment_type: 'Part Payment',
    discount_total: 0, tax_total: 0, core_total: 987, total: 987,
    created_on: '2025-04-04 11:50:37', order_from: 'POS', status: 'Success',
    part_payments: [ { payment_type: 'Cash', amount: 587 }, { payment_type: 'Card', amount: 400 } ] },
  OrderItem: [ { name: 'Chicken Drumstick Spicy (3 Pieces)', itemid: 136978202, category_name: 'Chicken Meal', price: 359, quantity: 1, total: 359 } ] } };

const pushZomato = { Token: 'f7a…', properties: {
  Restaurant: { restID: 'ry9zhytgrvi' },
  Order: { orderID: 44498, order_type: 'Delivery', payment_type: 'Online',
    discount_total: 0, tax_total: 17.76, core_total: 350, total: 373,
    created_on: '2026-01-19 16:42:24', order_from: 'Zomato', status: 'Success' },
  Tax: [ { title: 'CGST', amount: 8.88 }, { title: 'SGST', amount: 8.88 } ],
  OrderItem: [ { name: 'Kozhi Curry', itemid: 1284989, category_name: 'KARGEEN MAIN COURSE -NON VEG', price: 350, quantity: 1, total: 350, tax: 17.5 } ] } };

// ── PULL payloads (Get Orders API — note key differences) ───────────────────
const pull180 = {
  Restaurant: { restID: 'bosak1qj' },
  Order: { orderID: '180', order_type: 'Dine In', payment_type: 'Cash',
    discount_total: '219', tax_total: '31.96', core_total: '858', total: '671',
    created_on: '2025-12-17 14:59:38', order_from: 'POS', order_date: '2025-12-17', status: 'Success', part_payment: [] },
  OrderItem: [ { categoryid: '5821023', categoryname: 'Classic Cold Coffee [O]', name: 'Iced Mocha [o]', itemid: '144401426', price: '219', quantity: '1', total: '219' } ] };

const pullPartPay = {
  Restaurant: { restID: 'bosak1qj' },
  Order: { orderID: '182', order_type: 'Dine In', payment_type: 'Part Payment',
    discount_total: '0', tax_total: '29.4', core_total: '588', total: '617',
    created_on: '2025-12-17 15:02:20', order_from: 'POS', order_date: '2025-12-17', status: 'Success',
    part_payment: [ { payment_type: 'Other', amount: '117', custom_payment_type: 'EazyDiner' }, { payment_type: 'Card', amount: '500' }, { payment_type: 'Cash', amount: '0' } ] },
  OrderItem: [ { categoryname: 'Flavored Cold Coffee [O]', name: 'Caramel Cold Coffee [O]', itemid: '144401430', price: '169', quantity: '1', total: '169' } ] };

const pullZomato = {
  Restaurant: { restID: 'bosak1qj' },
  Order: { orderID: '207', order_type: 'Delivery', payment_type: 'Not Paid',
    discount_total: '50', tax_total: '23.5', core_total: '520', total: '494',
    created_on: '2026-02-19 14:56:36', order_from: 'Zomato', order_date: '2026-02-19', status: 'Success' },
  OrderItem: [ { categoryname: 'Non-Veg Combo [O]', name: 'Chicken Burger + Boneless Fried Chicken ( 2 Pieces)', itemid: '144401413', price: '180', quantity: '2', total: '360' } ] };

test('push: basic cash order → gross = total, cash bucket, POS channel', () => {
  const o = normalizeOrder(pushBasic);
  assert.equal(o.orderID, '114');
  assert.equal(o.date, '2025-04-04');
  assert.equal(o.gross, 1158);
  assert.equal(o.payMix.cash, 1158);
  assert.equal(o.channel, 'POS');
  assert.equal(o.itemList.length, 3);
  assert.equal(o.itemList[0].c, 'Chicken Meal');
});

test('push: discount order → discount captured, card bucket', () => {
  const o = normalizeOrder(pushDiscount);
  assert.equal(o.gross, 1034);
  assert.equal(o.discount, 253.4);
  assert.equal(o.payMix.card, 1034);
});

test('push: part-payment → split across cash + card, sums to gross', () => {
  const o = normalizeOrder(pushPartPay);
  assert.equal(o.gross, 987);
  assert.equal(o.payMix.cash, 587);
  assert.equal(o.payMix.card, 400);
  assert.equal(o.payMix.cash + o.payMix.card, o.gross);
});

test('push: Zomato aggregator → channel + tax, Online bucket', () => {
  const o = normalizeOrder(pushZomato);
  assert.equal(o.gross, 373);
  assert.equal(o.channel, 'Zomato');
  assert.equal(o.tax, 17.76);
  assert.equal(o.payMix.online, 373);
});

test('pull: string fields coerced, categoryname read, cash bucket', () => {
  const o = normalizeOrder(pull180);
  assert.equal(o.orderID, '180');
  assert.equal(o.date, '2025-12-17');
  assert.equal(o.gross, 671);
  assert.equal(o.discount, 219);
  assert.equal(o.tax, 31.96);
  assert.equal(o.payMix.cash, 671);
  assert.equal(o.itemList[0].c, 'Classic Cold Coffee [O]');
});

test('pull: part-payment with UPI(Other) + card, singular part_payment key', () => {
  const o = normalizeOrder(pullPartPay);
  assert.equal(o.gross, 617);
  assert.equal(o.payMix.upi, 117);   // "Other" → UPI
  assert.equal(o.payMix.card, 500);
  assert.equal(o.payMix.cash, 0);
});

test('pull: Zomato "Not Paid" still counts as revenue in online bucket', () => {
  const o = normalizeOrder(pullZomato);
  assert.equal(o.gross, 494);
  assert.equal(o.channel, 'Zomato');
  assert.equal(o.payMix.online, 494);
  assert.equal(o.discount, 50);
});

test('rollup: sums Success gross, excludes Cancelled, aggregates categories/pay', () => {
  const cancelled = normalizeOrder({ properties: { Restaurant: {}, Order: {
    orderID: 999, total: 5000, payment_type: 'Cash', order_from: 'POS',
    created_on: '2025-04-04 12:00:00', status: 'Cancelled' }, OrderItem: [] } });
  const orders = ['2025-04-04', pushBasic, pushDiscount].constructor === Array
    ? [normalizeOrder(pushBasic), normalizeOrder(pushDiscount), cancelled] : [];
  const rec = rollupDay('2025-04-04', orders);
  assert.equal(rec.gross, 1158 + 1034);            // cancelled 5000 excluded
  assert.equal(rec.discount, 253.4);
  assert.equal(rec.payMix.cash, 1158);
  assert.equal(rec.payMix.card, 1034);
  assert.equal(rec.orders, 2);
  assert.equal(rec.cancelled, 1);
  assert.equal(rec.categories['Chicken Meal'], 359 + 390 + 409);
  assert.equal(rec.from, '2025-04-04');
  assert.equal(rec.id, 'pp_2025-04-04');
});

test('idempotent: re-pushing the same orderID does not double-count', () => {
  // rebuildDay keys stored orders by orderID; simulate the dict merge here.
  const store = {};
  [normalizeOrder(pushBasic), normalizeOrder(pushBasic)].forEach(o => { store[o.orderID] = o; });
  const rec = rollupDay('2025-04-04', Object.values(store));
  assert.equal(rec.gross, 1158);   // not 2316
  assert.equal(rec.orders, 1);
});
