const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(name, expression) {
  const source = fs.readFileSync(path.join(__dirname, 'dictionaries', name), 'utf8');
  return vm.runInNewContext(source.replace(/export\s*\{[^}]+\};?/g, '') + '\n' + expression);
}
const output = path.join(root, 'components/InputMethod/assets/dictionary');
fs.mkdirSync(output, { recursive: true });
function write(name, data) {
  fs.writeFileSync(path.join(output, name + '.txt'), JSON.stringify(data) + '\n');
}
const chars = read('dic.js', 'getDict()');
const syllables = read('pinyin_syllables.js', 'syllables');
const words = read('dic_words.js', 'getWords()');
const initials = read('dic_words_initials.js', 'getInitialsIndex()');
write('cn', { chars, syllables });
const japanese = read('dic_jp.js', 'getDictJp()');
// ASCII-sorted readings permit binary lookup without expanding a JSON object.
// Stable deduplication removes repeated candidates without changing their order.
const jpLetters = [...new Set(Object.keys(japanese).map(key => key[0]))].sort().join('');
write('jp', { format: 'VIMJP-SHARDS1', letters: jpLetters });
const jpShards = {};
for (const letter of jpLetters) jpShards[letter] = [];
for (const key of Object.keys(japanese).sort()) {
  const value = [...new Set(japanese[key])].join('');
  if (!/^[a-z]+$/.test(key) || !value || /[\t\r\n]/.test(value)) throw Error('Invalid Japanese entry');
  jpShards[key[0]].push(key + '\t' + value + '\n');
}
for (const letter of jpLetters) {
  fs.writeFileSync(path.join(output, 'jp-' + letter + '.txt'), 'VIMJP1\n' + jpShards[letter].join(''));
}
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const shard = { words: {}, initials: {}, forward: {} };
  for (const key of Object.keys(words)) {
    if (key[0] !== letter) continue;
    shard.words[key] = words[key];
    if (key.length >= 2) {
      const prefix = key.slice(0, 2);
      (shard.forward[prefix] || (shard.forward[prefix] = [])).push(key);
    }
  }
  for (const key of Object.keys(initials)) {
    if (key[0] !== letter) continue;
    if (initials[key].some(word => word[0] !== letter)) throw Error('Invalid initials shard');
    shard.initials[key] = initials[key];
  }
  // Store word references once; indexes use compact shard-local numeric IDs.
  const ids = {};
  Object.keys(shard.words).forEach((key, index) => { ids[key] = index; });
  for (const index of [shard.initials, shard.forward]) {
    for (const key of Object.keys(index)) index[key] = index[key].map(word => ids[word]);
  }
  write('words-' + letter, shard);
}
console.log('Generated Chinese resources, ' + jpLetters.length + ' compact Japanese shards and 26 Chinese word shards.');
