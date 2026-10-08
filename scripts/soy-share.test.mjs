// node --test scripts/soy-share.test.mjs — SoyTrace share format and ranking (Feedback 5, P0-4 / P1-5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { formatShare, rankByShare, sharePct } from "../src/lib/soy-share.ts";

test("at most two decimals", () => {
  assert.equal(formatShare(0.2484, "en"), "0.25%");
  assert.equal(formatShare(0.0153, "en"), "0.02%");
  assert.equal(formatShare(0.1389, "en"), "0.14%");
  assert.equal(formatShare(99.985, "en"), "99.99%");
  assert.equal(formatShare(88.34, "en"), "88.34%");
  assert.equal(formatShare(7.4, "id"), "7,4%");
  assert.equal(formatShare(0.2484, "id"), "0,25%");
});

test("tiny shares and shares just under 100% never read as 0% or 100%", () => {
  assert.equal(formatShare(0.004, "en"), "< 0.01%");
  assert.equal(formatShare(99.998, "en"), "> 99.99%");
  assert.equal(formatShare(0, "en"), "0%");
  assert.equal(formatShare(100, "en"), "100%");
});

test("ranking uses raw shares, ties by name", () => {
  const items = [
    { n: "B", nc: 1, c: 999 },
    { n: "A", nc: 1, c: 999 },
    { n: "C", nc: 1.4, c: 998.6 },
  ];
  const ranked = rankByShare(items, (x) => sharePct(x.nc, x.nc + x.c), (x) => x.n).map((x) => x.n);
  assert.deepEqual(ranked, ["C", "A", "B"]);
});

// Acceptance list from the brief: elevators with the highest non-compliant share (by area).
const SUPPLY = new URL("../private-data/tenants/adm-soy/supply.json", import.meta.url);
test("Ask the data top 10 by non-compliant share matches the brief", { skip: !existsSync(SUPPLY) && "supply.json not built" }, () => {
  const d = JSON.parse(readFileSync(SUPPLY, "utf8"));
  const label = new Map([
    ...d.admElevators.map((e) => [e.id, `${e.name}, ${e.state}`]),
    ...d.thirdParty.map((e) => [e.id, `${e.company}, ${e.county} ${e.state}`]),
  ]);
  const rows = d.catchments.filter((k) => (k.kind === "adm" || k.kind === "tp") && k.compliant.acres + k.nonCompliant.acres > 0);
  const top = rankByShare(rows, (k) => sharePct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres), (k) => label.get(k.id))
    .slice(0, 9)
    .map((k) => [label.get(k.id), formatShare(sharePct(k.nonCompliant.acres, k.compliant.acres + k.nonCompliant.acres), "en")]);
  assert.deepEqual(top, [
    ["CGB, Madison Parish LA", "0.25%"],
    ["Viserion Grain, East Carroll Parish LA", "0.22%"],
    ["AGP, Buchanan MO", "0.14%"],
    ["Owensboro Grain, Daviess KY", "0.1%"],
    ["ADM Henderson, KY", "0.09%"],
    ["Agriservices Brunswick, Howell MO", "0.09%"],
    ["Bunge, Henderson KY", "0.09%"],
    ["ADM St Paul (Elevator D), MN", "0.08%"],
    ["Bunge, Daviess KY", "0.07%"],
  ]);
});
