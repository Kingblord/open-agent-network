/**
 * Surgical fix — @ban/eip7702 DelegationAuthorizationVerifier fail-closed.
 *
 * `AgentPermissionSchema.delegation` is now OPTIONAL (a PENDING permission
 * exists before the user signs). The verifier must therefore guard against a
 * permission with no delegation record: there is nothing to verify, so it
 * throws UNVERIFIED (fail-closed) instead of reading undefined fields.
 *
 * Fails loudly if the anchor is missing / not unique — nothing written.
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '..', 'packages/eip7702/src/index.ts');
let src = fs.readFileSync(file, 'utf8');

const anchor = '    const auth = input.permission.delegation;';
const count = src.split(anchor).length - 1;
if (count !== 1) {
  console.error(`ABORTED — anchor found ${count}x (expected exactly 1):\n  ${anchor}`);
  process.exit(1);
}

const replacement =
  anchor +
  `\n    if (!auth) {
      throw new EIP7702Error(
        EIP7702ErrorCodes.UNVERIFIED,
        \`Permission \${input.permission.id} has no delegation authorization to verify\`,
        { retryable: false },
      );
    }`;

src = src.split(anchor).join(replacement);
fs.writeFileSync(file, src);

// Belt + braces: verify the guard landed.
const check = fs.readFileSync(file, 'utf8');
if (!check.includes('has no delegation authorization to verify')) {
  console.error('VERIFY-FAIL — guard missing after write');
  process.exit(1);
}
console.log('patched OK + verified: packages/eip7702/src/index.ts (verifier delegation guard)');