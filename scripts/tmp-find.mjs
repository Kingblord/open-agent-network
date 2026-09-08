import fs from "node:fs";
const emoji = String.fromCodePoint(0x1F477);
const p = `c:/Users/${emoji} WORK/open-agent-network/packages/strategy-health/tests/health-strategy.test.ts`;
const s = fs.readFileSync(p, "utf8");
const lines = s.split("\n");
console.log("total lines:", lines.length);
for (let i = 0; i < lines.length; i++) {
  if (/describe\(/.test(lines[i]) || /^\}\);/.test(lines[i].trim())) console.log((i + 1) + ": " + lines[i].trim().slice(0, 90));
}
