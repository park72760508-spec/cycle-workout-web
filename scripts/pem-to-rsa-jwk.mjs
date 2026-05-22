#!/usr/bin/env node
/**
 * RSA PEM → Supabase Dashboard import용 JWK (RS256)
 *
 * Usage:
 *   node scripts/pem-to-rsa-jwk.mjs --private supabase_jwt_private.pem --kid <uuid>
 *   node scripts/pem-to-rsa-jwk.mjs --public supabase_jwt_public.pem --kid <uuid>
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const out = { private: null, public: null, kid: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--private") out.private = argv[++i];
    else if (argv[i] === "--public") out.public = argv[++i];
    else if (argv[i] === "--kid") out.kid = argv[++i];
  }
  return out;
}

function toBase64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function rsaPublicJwkFromKeyObject(keyObject, kid) {
  const jwk = keyObject.export({ format: "jwk" });
  if (jwk.kty !== "RSA") {
    throw new Error("Not an RSA key");
  }
  return {
    kty: "RSA",
    kid,
    alg: "RS256",
    use: "sig",
    n: jwk.n,
    e: jwk.e,
  };
}

function rsaPrivateJwkFromPem(pemPath, kid) {
  const pem = readFileSync(pemPath, "utf8");
  const key = createPrivateKey(pem);
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "RSA" || !jwk.d) {
    throw new Error("PEM must be RSA private key");
  }
  return {
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
}

const args = parseArgs(process.argv);
if (!args.kid) {
  console.error("Missing --kid <uuid>");
  process.exit(1);
}

if (args.private) {
  const jwk = rsaPrivateJwkFromPem(args.private, args.kid);
  console.log(JSON.stringify(jwk, null, 2));
  console.error("\n→ Supabase Dashboard: JWT Signing Keys → Import → 위 JSON 붙여넣기");
  console.error("→ Firebase Secret: supabase_jwt_private.pem 파일 내용");
} else if (args.public) {
  const pem = readFileSync(args.public, "utf8");
  const key = createPublicKey(pem);
  const jwk = rsaPublicJwkFromKeyObject(key, args.kid);
  console.log(JSON.stringify(jwk, null, 2));
  console.error("\n→ Supabase는 private JWK import 시 public이 자동 등록됩니다.");
} else {
  console.error("Provide --private <path> or --public <path>");
  process.exit(1);
}
