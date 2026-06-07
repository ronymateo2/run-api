// Web Push sender for Cloudflare Workers — pure Web Crypto, no Node deps.
// Implements RFC 8291 (Message Encryption, aes128gcm) + RFC 8292 (VAPID) using
// `jose` for the ES256 signature. Single-record encryption (payloads are tiny).

import { SignJWT, importJWK } from "jose";

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

export interface PushSub { endpoint: string; p256dh: string; auth: string; }

// RFC 8291 §3.4 + RFC 8188 aes128gcm. Returns the request body bytes.
async function encryptPayload(sub: PushSub, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh); // 65-byte uncompressed P-256 point
  const authSecret = b64urlToBytes(sub.auth); // 16 bytes

  // Ephemeral application-server ECDH keypair.
  const asPair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", asPair.publicKey)) as ArrayBuffer); // 65 bytes

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Cast: workerd's generated crypto types diverge from lib.dom for the ECDH algorithm field.
  const ecdhAlgo = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlgo, asPair.privateKey, 256));

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0" || ua_pub || as_pub).
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Single, final record → append delimiter 0x02, then encrypt.
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));

  // Header: salt(16) | rs(4 BE) | idlen(1) | keyid(as_pub 65) | ciphertext.
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

async function vapidHeader(endpoint: string, env: Env): Promise<string> {
  const url = new URL(endpoint);
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY); // 65 bytes
  const priv = b64urlToBytes(env.VAPID_PRIVATE_KEY); // 32 bytes
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(priv),
  };
  const key = await importJWK(jwk, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(`${url.protocol}//${url.host}`)
    .setSubject(env.VAPID_SUBJECT)
    .setExpirationTime("12h")
    .sign(key);
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Sends an encrypted push. Returns the HTTP status (201 ok; 404/410 = gone → prune).
export async function sendWebPush(sub: PushSub, payloadObj: unknown, env: Env): Promise<number> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payloadObj)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Authorization: await vapidHeader(sub.endpoint, env),
    },
    body,
  });
  return res.status;
}
