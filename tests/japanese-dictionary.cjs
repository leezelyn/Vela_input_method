const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const resource = path.join(root, 'components/InputMethod/assets/dictionary/jp.txt');
const text = fs.readFileSync(resource, 'utf8');
const source = fs.readFileSync(path.join(root, 'tools/dictionaries/dic_jp.js'), 'utf8');
const original = vm.runInNewContext(source.replace(/export\s*\{[^}]+\};?/g, '') + '\ngetDictJp()');
const originalJSON = JSON.stringify(original) + '\n';
assert.ok(Buffer.byteLength(text) <= 100,
  'Japanese base resource should only contain small shard metadata, not the whole dictionary');
const metadata = JSON.parse(text);
assert.equal(metadata.format, 'VIMJP-SHARDS1');
const readers = {};
let packedBytes = Buffer.byteLength(text);
for (const letter of metadata.letters) {
  const shardText = fs.readFileSync(path.join(path.dirname(resource), 'jp-' + letter + '.txt'), 'utf8');
  packedBytes += Buffer.byteLength(shardText);
  assert.ok(Buffer.byteLength(shardText) <= 3500, 'Every individual Japanese read must stay below 3.5 KB');
}

// A regression to expanded JSON storage must fail the size budget.
assert.ok(packedBytes <= Buffer.byteLength(originalJSON) * 0.81,
  'Japanese resource should use at least 19% less storage than the original JSON');

const { createJapaneseDictionary } = loadModule(path.join(root, 'components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
const { getJapaneseCandidates } = loadModule(path.join(root, 'components/InputMethod/assets/dicUtil.js'));
for (const letter of metadata.letters) {
  readers[letter] = createJapaneseDictionary(fs.readFileSync(path.join(path.dirname(resource), 'jp-' + letter + '.txt'), 'utf8'));
  assert.ok(readers[letter].indexBytes <= 350, 'Only a small per-letter index is needed at runtime');
}
const compact = {
  entryCount: Object.values(readers).reduce((sum, reader) => sum + reader.entryCount, 0),
  indexBytes: Object.values(readers).reduce((sum, reader) => sum + reader.indexBytes, 0),
  get(key) { return readers[key[0]] ? readers[key[0]].get(key) : ''; }
};
const legacy = createJapaneseDictionary(originalJSON);
assert.equal(compact.entryCount, Object.keys(original).length);
assert.ok(compact.indexBytes <= 2500, 'The full lookup index must stay below 2.5 KB');
assert.equal(compact.get('missing'), '');
assert.equal(compact.get(''), '');
const queries = new Set(['', 'shi', 'si', 'nn', 'n', "kan'i", 'konnichiha', 'nihongo', 'kyak', 'q']);
for (const [key, value] of Object.entries(original)) {
  const unique = [...new Set(value)].join('');
  assert.equal(compact.get(key), unique, key + ': preserve every unique character and its order');
  assert.equal(legacy.get(key), value, key + ': custom JSON resources still work');
  for (let length = 1; length <= key.length; length++) queries.add(key.slice(0, length));
  queries.add(key + 'x');
}
for (const query of queries) {
  assert.deepEqual(JSON.parse(JSON.stringify(getJapaneseCandidates(query, compact))),
    JSON.parse(JSON.stringify(getJapaneseCandidates(query, original))), query + ': candidate/display/offset parity');
}

// Reject damaged resources so the existing loader can release state and retry.
for (const invalid of ['', '{broken', 'VIMJP2\na\tあ\n', 'VIMJP1\na\t\n',
  'VIMJP1\nb\tび\na\tあ\n', 'VIMJP1\na\tあ\na\tあ\n', 'VIMJP1\na あ\n']) {
  assert.throws(() => createJapaneseDictionary(invalid));
}
const tiny = createJapaneseDictionary('VIMJP1\na\tあ\nb\tび\n');
assert.equal(tiny.get('a'), 'あ');
assert.equal(tiny.get('b'), 'び');
assert.equal(tiny.get('aa'), '');
// Larger custom resources must use 32-bit offsets instead of truncating above 64K.
const large = createJapaneseDictionary('VIMJP1\na\t' + 'あ'.repeat(66000) + '\nz\t図\n');
assert.equal(large.get('z'), '図');

// Validate the actual loader with compact and legacy files, corrupt reads and eviction.
const { createDictionaryLoader } = loadModule(path.join(root, 'components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
for (const data of [text, originalJSON]) {
  const queue = [], reads = [], results = [];
  const loader = createDictionaryLoader(undefined, options => { queue.push(options); reads.push(options.uri); });
  loader.search('n', 'jp', result => results.push(result));
  loader.search('neko', 'jp', result => results.push(result));
  assert.equal(reads.length, 1);
  while (queue.length) {
    const request = queue.shift();
    request.success({ text: request.uri.endsWith('/jp.txt') ? data : fs.readFileSync(path.join(root, request.uri), 'utf8') });
  }
  assert.equal(results.length, 1, 'Only latest composition should be delivered');
  assert.ok(results[0].chars.includes('猫'));
  loader.search('nihon', 'jp', result => results.push(result));
  const warmReads = data === text ? 2 : 1;
  assert.equal(reads.length, warmReads, 'Warm input in the same shard must not read again');
  loader.release();
  loader.search('neko', 'jp', result => results.push(result));
  assert.equal(reads.length, warmReads + 1, 'Release must drop shard metadata and contents too');
  const old = queue.shift();
  loader.destroy(); old.success({ text: data });
  assert.equal(results.length, 2, 'Destroy must suppress callbacks');
}
const queue = [], shardReads = [], shardResults = [];
const sharded = createDictionaryLoader(undefined, options => { queue.push(options); shardReads.push(path.basename(options.uri)); });
function flush() {
  let limit = 5;
  while (queue.length && limit--) {
    const request = queue.shift();
    request.success({ text: fs.readFileSync(path.join(root, request.uri), 'utf8') });
  }
  assert.ok(limit >= 0);
}
for (const word of ['neko', 'nihon', 'kanji', 'neko']) {
  sharded.search(word, 'jp', result => shardResults.push(result)); flush();
}
assert.deepEqual(shardReads, ['jp.txt', 'jp-n.txt', 'jp-k.txt', 'jp-n.txt'],
  'Changing the first letter must evict the previous shard instead of retaining the whole dictionary');
sharded.search('q', 'jp', result => shardResults.push(result)); flush();
assert.equal(shardReads.length, 4, 'A missing letter needs no nonexistent shard read');
sharded.search('neko', 'jp', result => shardResults.push(result)); flush();
assert.equal(shardReads.at(-1), 'jp-n.txt', 'Unknown first letters must release the previous shard too');
sharded.destroy();
const raceQueue = [], raceResults = [], raceReads = [];
const racing = createDictionaryLoader(undefined, options => { raceQueue.push(options); raceReads.push(path.basename(options.uri)); });
const query = word => racing.search(word, 'jp', result => raceResults.push({ word, result }));
query('neko');
const baseRead = raceQueue.shift(); baseRead.success({ text });
assert.equal(raceReads.at(-1), 'jp-n.txt');
query('kanji');
// An obsolete read must not be parsed, even if its file contents are corrupt.
raceQueue.shift().success({ text: '{broken' });
assert.equal(raceResults.length, 0);
const latest = raceQueue.shift();
assert.ok(latest.uri.endsWith('/jp-k.txt'));
latest.success({ text: fs.readFileSync(path.join(root, latest.uri), 'utf8') });
assert.deepEqual(raceResults.map(item => item.word), ['kanji']);
query('neko'); query('');
raceQueue.shift().success({ text: '{broken' });
assert.equal(raceResults.at(-1).word, '');
assert.equal(raceResults.at(-1).result.chars.length, 0, 'Clearing input during a shard read must complete safely');
racing.destroy();
console.log('Passed: ' + compact.entryCount + ' Japanese readings, ' + queries.size + ' candidate parity queries, compact/legacy loading and resource validation.');
