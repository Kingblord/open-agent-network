// Surgical fixes for apps/web/components/permission-cards.tsx
// 1) yParity must be a NUMBER (0|1), not a string — schema: z.number().int().min(0).max(1)
// 2) thirdweb v5 wallet API is signMessage, not sign (sign does not exist)
const fs = require('node:fs')

const file = 'apps/web/components/permission-cards.tsx'
let src = fs.readFileSync(file, 'utf8')
const before = src.length
const missing = []

const apply = (anchor, replacement, label) => {
  if (!src.includes(anchor)) {
    missing.push(label)
    return
  }
  src = src.split(anchor).join(replacement)
}

apply("          yParity: '0',", '          yParity: 0,', 'yParity-number')
apply(
  'await activeAccount.sign({ message: digest as `0x${string}` })',
  'await activeAccount.signMessage({ message: digest as `0x${string}` })',
  'signMessage-API',
)

if (missing.length > 0) {
  console.error('MISSING ANCHORS (nothing written):', missing.join(', '))
  process.exit(1)
}

fs.writeFileSync(file, src)
console.log(`patched OK: ${file} (${before} -> ${src.length} bytes)`)