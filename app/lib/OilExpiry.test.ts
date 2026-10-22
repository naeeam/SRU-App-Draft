import assert from "node:assert/strict";
import test from "node:test";
import { allocateOil, availableOil, refundableOil, singaporeDate, type OilCredit } from "./OilExpiry";

const credits: OilCredit[] = [
  { id: "later", amount: 2, remaining: 2, expiryDate: "2026-11-30" },
  { id: "first", amount: 1.5, remaining: 1.5, expiryDate: "2026-10-24" },
];

test("Singapore expiry date is inclusive", () => {
  assert.equal(availableOil(credits, "2026-10-24"), 3.5);
  assert.equal(availableOil(credits, "2026-10-25"), 2);
});

test("Singapore day changes at UTC+08:00 midnight", () => {
  assert.equal(singaporeDate(new Date("2026-10-24T15:59:59Z")), "2026-10-24");
  assert.equal(singaporeDate(new Date("2026-10-24T16:00:00Z")), "2026-10-25");
});

test("application date rather than future leave date controls expiry", () => {
  assert.deepEqual(allocateOil(credits, 2, "2026-10-24"), {
    allocations: [
      { creditId: "first", amount: 1.5, expiryDate: "2026-10-24" },
      { creditId: "later", amount: 0.5, expiryDate: "2026-11-30" },
    ],
    shortfall: 0,
  });
});

test("expired credits cannot be spent", () => {
  assert.deepEqual(allocateOil(credits, 2.5, "2026-10-25"), {
    allocations: [{ creditId: "later", amount: 2, expiryDate: "2026-11-30" }],
    shortfall: 0.5,
  });
});

test("rejection or cancellation never revives expired credits", () => {
  const allocations = allocateOil(credits, 2, "2026-10-24").allocations;
  assert.deepEqual(refundableOil(allocations, "2026-10-25"), [
    { creditId: "later", amount: 0.5, expiryDate: "2026-11-30" },
  ]);
});

test("rejects invalid credit balances and dates", () => {
  assert.throws(() => allocateOil([{ ...credits[0], remaining: Number.NaN }], 1, "2026-10-24"));
  assert.throws(() => allocateOil([{ ...credits[0], remaining: 3 }], 1, "2026-10-24"));
  assert.throws(() => allocateOil(credits, 1, "2026-02-30"));
});
