const HEADER = 'VIMJP1\n'

// Retain one text buffer and one small offset array instead of 1,203 key/value pairs.
// The reader lives outside reactive component data and is released with its loader.
function createJapaneseDictionary(text) {
  if (typeof text !== 'string') throw new Error('Invalid Japanese dictionary text')
  if (/^\s*\{/.test(text)) {
    // Older/custom dictionarypath resources can still use the original JSON format.
    const values = JSON.parse(text)
    const keys = Object.keys(values)
    for (const key of keys) {
      if (!/^[a-z]+$/.test(key) || typeof values[key] !== 'string' || !values[key]) {
        throw new Error('Invalid Japanese dictionary entry')
      }
    }
    return { get: key => values[key] || '', entryCount: keys.length, indexBytes: 0 }
  }
  if (text.indexOf(HEADER) !== 0 || text[text.length - 1] !== '\n') {
    throw new Error('Invalid Japanese dictionary format')
  }
  let count = 0
  for (let i = HEADER.length; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  const offsets = text.length <= 0xffff ? new Uint16Array(count) : new Uint32Array(count)
  let start = HEADER.length
  let previous = ''
  for (let i = 0; i < count; i++) {
    const end = text.indexOf('\n', start)
    const tab = text.indexOf('\t', start)
    const key = tab < 0 ? '' : text.slice(start, tab)
    if (tab < start || tab >= end - 1 || !/^[a-z]+$/.test(key) || key <= previous ||
      text.slice(tab + 1, end).indexOf('\t') !== -1 || text[end - 1] === '\r') {
      throw new Error('Invalid or unsorted Japanese dictionary entry')
    }
    offsets[i] = start
    previous = key
    start = end + 1
  }
  return {
    entryCount: count,
    indexBytes: offsets.byteLength,
    get(key) {
      let low = 0
      let high = count - 1
      while (low <= high) {
        const mid = (low + high) >>> 1
        const begin = offsets[mid]
        const tab = text.indexOf('\t', begin)
        const length = tab - begin
        let order = 0
        for (let i = 0; i < Math.min(key.length, length); i++) {
          order = key.charCodeAt(i) - text.charCodeAt(begin + i)
          if (order) break
        }
        if (!order) order = key.length - length
        if (!order) return text.slice(tab + 1, text.indexOf('\n', tab))
        if (order < 0) high = mid - 1
        else low = mid + 1
      }
      return ''
    }
  }
}

export { createJapaneseDictionary }
