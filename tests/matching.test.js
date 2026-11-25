import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, fold, skillScore, isNewSince, sortJobs } from "../web/matching.js";

const profile = {
  positions: ["e-commerce", "eshop"],
  locations: ["Praha"],
  modes: ["onsite", "hybrid", "remote"],
  minSalary: 50000,
  employment: ["plny"],
  banned: ["call centrum"],
  skills: [
    { name: "Google Ads", aliases: ["PPC", "AdWords"], level: 3 },
    { name: "Shoptet", aliases: [], level: 2 },
    { name: "SQL", aliases: [], level: 1 },
  ],
};

const base = {
  title: "E-commerce manažer",
  description: "Správa PPC kampaní a e-shopu na Shoptetu.",
  location: "Praha 5",
  remote: "hybrid",
  employment: ["plny"],
  salary_min: 60000,
  salary_max: 80000,
  tags: [],
};

test("fold odstraní diakritiku a pomlčky", () => {
  assert.equal(fold("E-shop Manažer"), "eshop manazer");
});

test("vyhovující inzerát projde", () => {
  const r = evaluate(base, profile);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.pass, true);
});

test("pozice se hledá v názvu bez ohledu na pomlčky", () => {
  assert.equal(evaluate({ ...base, title: "Vedoucí E-shopu" }, profile).pass, true);
  assert.deepEqual(evaluate({ ...base, title: "Účetní" }, profile).reasons, ["pozice"]);
});

test("inzerát bez platu projde, nízký plat ne", () => {
  assert.equal(evaluate({ ...base, salary_min: null, salary_max: null }, profile).pass, true);
  assert.deepEqual(evaluate({ ...base, salary_min: 30000, salary_max: 40000 }, profile).reasons, ["plat"]);
});

test("lokalita: jiné město neprojde, remote ano", () => {
  assert.deepEqual(evaluate({ ...base, location: "Brno" }, profile).reasons, ["lokalita"]);
  assert.equal(evaluate({ ...base, location: "Brno", remote: "remote" }, profile).pass, true);
  assert.equal(evaluate({ ...base, location: null }, profile).pass, true);
});

test("režim práce a úvazek", () => {
  const onlyRemote = { ...profile, modes: ["remote"] };
  assert.ok(evaluate(base, onlyRemote).reasons.includes("režim práce"));
  assert.ok(evaluate({ ...base, employment: ["castecny"] }, profile).reasons.includes("úvazek"));
  assert.equal(evaluate({ ...base, employment: [] }, profile).pass, true);
});

test("zakázané slovo", () => {
  const r = evaluate({ ...base, description: "Práce v call centru… call centrum" }, profile);
  assert.ok(r.reasons.includes("zakázané slovo"));
});

test("skóre počítá váhy a synonyma", () => {
  const r = skillScore("Správa PPC kampaní na Shoptetu", profile.skills);
  // Google Ads (3) přes synonymum PPC, Shoptet (2) i ve tvaru „Shoptetu“, SQL (1) chybí
  assert.deepEqual(r.matched, ["Google Ads", "Shoptet"]);
  assert.deepEqual(r.missing, ["SQL"]);
  assert.equal(r.score, 83);
});

test("krátké skills se hledají jako celá slova", () => {
  assert.deepEqual(skillScore("Používáme MySQL", profile.skills).matched, []);
  assert.deepEqual(skillScore("Znalost SQL výhodou", profile.skills).matched, ["SQL"]);
});

test("nové od minula a řazení", () => {
  assert.equal(isNewSince({ first_seen: "2026-11-25" }, "2026-11-24"), true);
  assert.equal(isNewSince({ first_seen: "2026-11-24" }, "2026-11-24"), false);
  const a = { isNew: false, result: { score: 90 }, job: { first_seen: "1" } };
  const b = { isNew: true, result: { score: 10 }, job: { first_seen: "1" } };
  assert.deepEqual(sortJobs([a, b]), [b, a]);
});
