// Small, synchronous romaji conversion table; kanji stays in the lazy dictionary.
const kana = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', ya: 'や', yu: 'ゆ', yo: 'よ', wa: 'わ', wo: 'を', '-': 'ー' }
function row(prefix, characters) {
  const vowels = 'aiueo'
  for (let i = 0; i < vowels.length; i++) kana[prefix + vowels[i]] = characters[i]
}
row('k', 'かきくけこ')
row('g', 'がぎぐげご')
row('s', 'さしすせそ')
row('z', 'ざじずぜぞ')
row('t', 'たちつてと')
row('d', 'だぢづでど')
row('n', 'なにぬねの')
row('h', 'はひふへほ')
row('b', 'ばびぶべぼ')
row('p', 'ぱぴぷぺぽ')
row('m', 'まみむめも')
row('r', 'らりるれろ')
for (const prefix of ['x', 'l']) {
  row(prefix, 'ぁぃぅぇぉ')
  kana[prefix + 'ya'] = 'ゃ'
  kana[prefix + 'yu'] = 'ゅ'
  kana[prefix + 'yo'] = 'ょ'
  kana[prefix + 'wa'] = 'ゎ'
  kana[prefix + 'tu'] = 'っ'
  kana[prefix + 'tsu'] = 'っ'
  kana[prefix + 'ka'] = 'ゕ'
  kana[prefix + 'ke'] = 'ゖ'
}
const aliases = {
  shi: 'し', chi: 'ち', tsu: 'つ', fu: 'ふ', ji: 'じ', ci: 'し',
  yi: 'い', wu: 'う', ye: 'いぇ', wi: 'うぃ', we: 'うぇ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  tsa: 'つぁ', tsi: 'つぃ', tse: 'つぇ', tso: 'つぉ',
  she: 'しぇ', sye: 'しぇ', che: 'ちぇ', tye: 'ちぇ',
  je: 'じぇ', jye: 'じぇ', zye: 'じぇ',
  thi: 'てぃ', thu: 'てゅ', the: 'てぇ', tho: 'てょ', tha: 'てゃ',
  dhi: 'でぃ', dhu: 'でゅ', dhe: 'でぇ', dho: 'でょ', dha: 'でゃ',
  twa: 'とぁ', twi: 'とぃ', twu: 'とぅ', twe: 'とぇ', two: 'とぉ',
  dwa: 'どぁ', dwi: 'どぃ', dwu: 'どぅ', dwe: 'どぇ', dwo: 'どぉ',
  kwa: 'くぁ', kwi: 'くぃ', kwu: 'くぅ', kwe: 'くぇ', kwo: 'くぉ',
  qa: 'くぁ', qi: 'くぃ', qu: 'く', qe: 'くぇ', qo: 'くぉ',
  gwa: 'ぐぁ', gwi: 'ぐぃ', gwu: 'ぐぅ', gwe: 'ぐぇ', gwo: 'ぐぉ'
}
for (const key in aliases) kana[key] = aliases[key]
const contracted = { ky: 'き', gy: 'ぎ', sy: 'し', sh: 'し', zy: 'じ', jy: 'じ', j: 'じ', ty: 'ち', ch: 'ち', cy: 'ち', dy: 'ぢ', ny: 'に', hy: 'ひ', by: 'び', py: 'ぴ', my: 'み', ry: 'り', fy: 'ふ', vy: 'ゔ' }
for (const prefix in contracted) {
  kana[prefix + 'a'] = contracted[prefix] + 'ゃ'
  kana[prefix + 'u'] = contracted[prefix] + 'ゅ'
  kana[prefix + 'o'] = contracted[prefix] + 'ょ'
}

function katakana(text) {
  let output = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    output += code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : text[i]
  }
  return output
}

function convertRomaji(input) {
  const text = input.toLowerCase()
  const tokens = []
  let offset = 0
  let reading = ''
  while (offset < text.length) {
    let value = ''
    let length = 0
    const first = text[offset]
    const next = text[offset + 1] || ''
    if (first === 'n' && next === "'") { value = 'ん'; length = 2 }
    else if (first === 'n' && next === 'n') {
      value = 'ん'
      // nna/nni/nnya: the second n starts the next kana; terminal nn is one nasal.
      length = /^[aiueoy]$/.test(text[offset + 2] || '') ? 1 : 2
    } else if (first === 'n' && (!next || !/^[aiueoy]$/.test(next))) { value = 'ん'; length = 1 }
    else if (/^[bcdfghjkpqrstvwz]$/.test(first) && first === next) { value = 'っ'; length = 1 }
    else if (text.substr(offset, 3) === 'tch') { value = 'っ'; length = 1 }
    else {
      for (let size = Math.min(4, text.length - offset); size > 0; size--) {
        const key = text.substr(offset, size)
        if (kana[key]) { value = kana[key]; length = size; break }
      }
    }
    // Keep unfinished/unknown input in composition, rather than silently dropping it.
    if (!length) break
    offset += length
    reading += value
    tokens.push({ text: value, offset })
  }
  return { reading, offset, tokens }
}

function getJapaneseCandidates(input, dictionary = {}) {
  const converted = convertRomaji(input)
  const candidates = []
  function add(text, offset) {
    if (text && !candidates.some(candidate => candidate.text === text)) candidates.push({ text, offset })
  }
  add(converted.reading, converted.offset)
  add(katakana(converted.reading), converted.offset)
  // Match only complete romaji boundaries: kani must not consume kan as 漢.
  for (let i = converted.tokens.length - 1; i >= 0; i--) {
    const offset = converted.tokens[i].offset
    const key = input.slice(0, offset).toLowerCase().replace(/'/g, '')
    const value = typeof dictionary.get === 'function' ? dictionary.get(key) : dictionary[key]
    if (!value) continue
    for (const character of value.split('')) add(character, offset)
    break
  }
  if (converted.tokens.length > 1) {
    const first = converted.tokens[0]
    add(first.text, first.offset)
    add(katakana(first.text), first.offset)
  }
  return {
    chars: candidates.map(candidate => candidate.text),
    matched: input.slice(0, converted.offset), multi: null, candidates,
    display: converted.reading + input.slice(converted.offset)
  }
}

export { getJapaneseCandidates }
