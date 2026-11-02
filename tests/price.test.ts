import test from "node:test";
import assert from "node:assert/strict";
import { extractPrice } from "../src/extract/price.js";
import { ExtractionContext } from "../src/extract/context.js";
import { makeSnapshot } from "./fixtures.js";

function priceFor(snapshot: ReturnType<typeof makeSnapshot>) {
  return extractPrice(snapshot, new ExtractionContext(snapshot));
}

test("separates listed price from MRP and keeps cashback/EMI/exchange out of price arithmetic", () => {
  const snapshot = makeSnapshot({
    price: {
      coreTexts: [
        "₹1,02,990.00 with 44 percent savings M.R.P.: ₹1,85,000.00",
      ],
      priceTexts: ["₹1,02,990.00", "₹1,85,000.00"],
      mrpTexts: ["₹1,85,000.00"],
      otherOfferTexts: [
        "Upto ₹3,089.00 cashback as Amazon Pay Balance when you pay with Amazon Pay ICICI Bank Credit Cards",
        "Upto ₹3,014.16 EMI interest savings on Amazon Pay ICICI Bank Credit Cards",
        "Upto ₹2,000.00 discount on HDFC Bank Credit Cards, HDFC Bank Debit Cards",
      ],
      buyboxText: "With Exchange\nUp to 8,750.00 off\nWithout Exchange",
    },
  });
  const price = priceFor(snapshot);
  assert.equal(price.listedPrice?.amount, 102990);
  assert.equal(price.mrp?.amount, 185000);
  assert.equal(price.bestEffectivePrice?.amount, 102990);
  assert.equal(price.priceWithoutConditionalOffers?.amount, 102990);
  assert.equal(price.conditionalBestPrice, null);

  const cashback = price.offers.find((offer) => offer.type === "cashback");
  assert.equal(cashback?.cashback?.amount, 3089);
  assert.equal(cashback?.discount, null);

  const emi = price.offers.find((offer) => offer.type === "no_cost_emi");
  assert.ok(emi);
  assert.equal(emi.discount, null);

  const exchange = price.offers.find((offer) => offer.type === "exchange");
  assert.equal(exchange?.cap?.amount, 8750);
  assert.equal(exchange?.discount, null);
});

test("computes a conditional best from one offer but never stacks offers", () => {
  const snapshot = makeSnapshot({
    price: {
      priceTexts: ["₹1,00,000.00"],
      couponTexts: ["Save ₹2,000 with coupon"],
      bankOfferTexts: [
        "10% instant discount up to ₹1,500 with HDFC Bank Credit Card",
      ],
    },
  });
  const price = priceFor(snapshot);
  assert.equal(price.listedPrice?.amount, 100000);
  assert.equal(price.bestEffectivePrice?.amount, 100000);
  assert.equal(price.conditionalBestPrice?.amount, 98000);
  assert.equal(price.priceWithoutConditionalOffers?.amount, 100000);
  const applied = price.offers.filter((offer) => offer.appliedIn === "conditional_best");
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.type, "coupon");
  assert.ok(
    price.calculationNotes.some((note) => note.includes("not stacked")),
  );
});

test("does not subtract cashback from the price", () => {
  const snapshot = makeSnapshot({
    price: {
      priceTexts: ["₹1,00,000.00"],
      otherOfferTexts: ["5% cashback up to ₹500 on HDFC Credit Card"],
    },
  });
  const price = priceFor(snapshot);
  assert.equal(price.bestEffectivePrice?.amount, 100000);
  assert.equal(price.conditionalBestPrice, null);
  const cashback = price.offers.find((offer) => offer.type === "cashback");
  assert.equal(cashback?.cashback?.amount, 500);
  assert.equal(cashback?.appliedIn, "none");
});

test("leaves percentage discounts without a cap as unknown", () => {
  const snapshot = makeSnapshot({
    price: {
      priceTexts: ["₹1,00,000.00"],
      couponTexts: ["Save 10% with coupon"],
    },
  });
  const price = priceFor(snapshot);
  const coupon = price.offers.find((offer) => offer.type === "coupon");
  assert.equal(coupon?.percent, 10);
  assert.equal(coupon?.discount, null);
  assert.equal(price.conditionalBestPrice, null);
});

test("aggregates explicitly additional bank offers into non-EMI and EMI stacks", () => {
  const bankOfferDetails = [
    "Additional Flat INR 2000 Instant Discount on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 69990.00",
    "10% Instant Discount up to INR 1250 on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 2490.00",
    "Additional Flat INR 750 Instant Discount on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 39990.00",
    "Additional Flat INR 750 Instant Discount on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 49990.00",
    "Additional Flat INR 500 Instant Discount on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 24990.00",
    "Additional Flat INR 500 Instant Discount on HDFC Bank Credit Card Non-EMI Trxn. Min purchase value INR 34990.00",
    "Additional Flat INR 300 Instant Discount on HDFC Bank Credit Card Trxn. Min purchase value INR 19990.00",
    "Additional Flat INR 2000 Instant Discount on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 69990.00",
    "10% Instant Discount up to INR 1750 on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 2490.00",
    "Additional Flat INR 750 Instant Discount on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 39990.00",
    "Additional Flat INR 750 Instant Discount on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 49990.00",
    "Additional Flat INR 500 Instant Discount on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 24990.00",
    "Additional Flat INR 500 Instant Discount on HDFC Bank Credit Card 9month and above EMI Trxn. Min purchase value INR 19990.00",
    "Additional Flat INR 500 Instant Discount on HDFC Bank Credit Card 9month and above EMI Trxn. Min purchase value INR 29990.00",
    "Additional Flat INR 1000 Instant Discount on HDFC Bank Credit Card 9month and above EMI Trxn. Min purchase value INR 99990.00",
  ];
  const snapshot = makeSnapshot({
    price: {
      priceTexts: ["₹1,02,990.00"],
      bankOfferDetails,
    },
  });
  const price = priceFor(snapshot);
  const banks = price.offers.filter(
    (offer) => offer.type === "bank_instant_discount",
  );
  assert.equal(banks.length, 2);
  const nonEmi = banks.find((offer) => offer.rawText.includes("non-EMI"));
  const emi = banks.find(
    (offer) => offer.rawText.includes("EMI") && !offer.rawText.includes("non-EMI"),
  );
  assert.equal(nonEmi?.discount?.amount, 6050);
  assert.equal(emi?.discount?.amount, 7750);
  assert.equal(nonEmi?.components?.length, 7);
  assert.equal(emi?.components?.length, 8);
  assert.ok(nonEmi?.calculation?.includes("Buy for ₹96,940"));
  assert.ok(emi?.calculation?.includes("Buy for ₹95,240"));
  assert.equal(price.conditionalBestPrice?.amount, 96940);
  assert.equal(price.emiConditionalBestPrice?.amount, 95240);
  assert.equal(price.conditionalOfferId, nonEmi?.id);
  assert.equal(price.emiConditionalOfferId, emi?.id);
  assert.equal(nonEmi?.appliedIn, "conditional_best");
  assert.equal(emi?.appliedIn, "emi_conditional");
  assert.equal(price.bestEffectivePrice?.amount, 102990);
});

test("never uses an EMI-only offer as the full-payment conditional price", () => {
  const snapshot = makeSnapshot({
    price: {
      priceTexts: ["₹1,00,000.00"],
      bankOfferDetails: [
        "10% Instant Discount up to INR 1750 on HDFC Bank Credit Card 6month and above EMI Trxn. Min purchase value INR 2490.00",
      ],
    },
  });
  const price = priceFor(snapshot);
  assert.equal(price.conditionalBestPrice, null);
  assert.equal(price.emiConditionalBestPrice?.amount, 98250);
});

test("does not invent prices when the listed price is missing", () => {
  const snapshot = makeSnapshot();
  const price = priceFor(snapshot);
  assert.equal(price.listedPrice, null);
  assert.equal(price.bestEffectivePrice, null);
  assert.equal(price.conditionalBestPrice, null);
  assert.ok(price.calculationNotes.some((note) => note.includes("could not be determined")));
});
