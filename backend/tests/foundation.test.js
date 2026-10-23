import test from "node:test";
import assert from "node:assert/strict";
import { createBlankCompanyData } from "../src/database.js";
import { hashPassword } from "../src/auth.js";

test("blank company starts with LKR, FIFO, no tax, and a starter chart", () => {
  const data = createBlankCompanyData();

  assert.equal(data.company.baseCurrency, "LKR");
  assert.equal(data.company.inventoryMethod, "FIFO");
  assert.equal(data.company.tax.enabled, false);
  assert.equal(data.customers.length, 0);
  assert.equal(data.suppliers.length, 0);
  assert.deepEqual(data.journalEntries, []);
  assert.ok(data.accounts.some((account) => account.id === "opening-balance-equity"));
  assert.ok(data.accounts.some((account) => account.kind === "cash"));
  assert.ok(data.accounts.some((account) => account.kind === "bank"));
  assert.ok(data.accounts.some((account) => account.controlAccount));
});

test("password hashing enforces a minimum length and stores only a salted hash", async () => {
  await assert.rejects(hashPassword("short"), /12 and 256 characters/);
  const hashed = await hashPassword("private-test-password");

  assert.match(hashed, /^[\da-f]+:[\da-f]+$/i);
  assert.notEqual(hashed, "private-test-password");
});
