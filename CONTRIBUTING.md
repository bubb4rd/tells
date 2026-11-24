# Contributing

Three kinds of change are useful, in this order.

## 1. False positives

A rule that fires on good work costs more than a rule that misses bad work, because people learn to ignore it. If a rule fires where it shouldn't, open a [false positive](../../issues/new?template=false-positive.yml) issue with the snippet. A fix needs a fixture that proves it: add the snippet to `test/fixtures/clean/` (or a new clean file) and make the test pass.

## 2. New tells

Open a [new tell](../../issues/new?template=new-tell.yml) issue first. A tell gets in when:

- it shows up across unrelated generated screens, not one model's habit on one day;
- you can say what to do instead, and the answer points back to the subject;
- removing it doesn't make the screen worse. Take it out: does the reader lose anything they'd miss?

Rules about feel ("looks templated", "lacks soul") don't get in. They were the weakest rules in testing, and they push generators away from plain, finished work.

## 3. Linter rules

Every rule in `src/check.mjs` or `src/render.mjs` needs:

- an id, category, severity and a one-line fix in the `RULES` table;
- a fixture in `test/fixtures/check/<id>.html` or `test/fixtures/render/<id>.html` that makes it fire;
- no new hits on `test/fixtures/clean/`;
- the README table regenerated with `node scripts/rules-table.mjs`.

Use `error` for things that are wrong nearly everywhere and `warn` for things that need a reason. Keep the linters free of dependencies.

```sh
npm test
node scripts/rules-table.mjs --check
```

## Writing

The docs practise the rules: short sentences, no marketing adjectives, no em-dash runs, and buttons and links that name the action.
