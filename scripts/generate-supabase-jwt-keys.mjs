#!/usr/bin/env node
/**
 * OpenSSL 없이 RS256 키 페어 생성 (Windows/macOS/Linux 공통)
 *
 * Usage:
 *   node scripts/generate-supabase-jwt-keys.mjs
 *   node scripts/generate-supabase-jwt-keys.mjs --out ./keys
 */
import { generateKeyPairSync, randomUUID, createPrivateKey } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseOutDir(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) return resolve(argv[++i]);
  }
  return resolve(__dirname, "..", "keys", "supabase-jwt");
}

const outDir = parseOutDir(process.argv);
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const kid = randomUUID().toLowerCase();

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const privatePath = join(outDir, "supabase_jwt_private.pem");
const publicPath = join(outDir, "supabase_jwt_public.pem");
const kidPath = join(outDir, "SUPABASE_JWT_KEY_ID.txt");
const jwkPath = join(outDir, "supabase_jwt_private.jwk.json");

writeFileSync(privatePath, privateKey, "utf8");
writeFileSync(publicPath, publicKey, "utf8");
writeFileSync(kidPath, kid, "utf8");

const key = createPrivateKey(privateKey);
const jwk = key.export({ format: "jwk" });
const privateJwk = {
  kty: "RSA",
  kid,
  alg: "RS256",
  use: "sig",
  n: jwk.n,
  e: jwk.e,
  d: jwk.d,
  p: jwk.p,
  q: jwk.q,
  dp: jwk.dp,
  dq: jwk.dq,
  qi: jwk.qi,
};
writeFileSync(jwkPath, JSON.stringify(privateJwk, null, 2), "utf8");

console.log("");
console.log("=== Supabase JWT RS256 키 생성 완료 (Node.js) ===");
console.log("");
console.log("Private PEM :", privatePath);
console.log("Public PEM  :", publicPath);
console.log("kid         :", kid);
console.log("Private JWK :", jwkPath);
console.log("");
console.log("다음 단계:");
console.log("  1) Supabase Dashboard → Settings → API → JWT Signing Keys");
console.log("     → Import →", jwkPath, "내용 붙여넣기 → Rotate");
console.log("  2) Firebase Secret:");
console.log(
  '     Get-Content "' +
    privatePath +
    '" -Raw | firebase functions:secrets:set SUPABASE_CUSTOM_PRIVATE_KEY'
);
console.log("  3) Firebase Param:");
console.log('     firebase functions:params:set SUPABASE_JWT_KEY_ID="' + kid + '"');
console.log("");
