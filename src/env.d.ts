// VAPID bindings for Web Push. PUBLIC_KEY + SUBJECT live in wrangler.toml [vars];
// PRIVATE_KEY is a secret (`wrangler secret put VAPID_PRIVATE_KEY`). Declaration-merged
// into the wrangler-generated Cloudflare.Env so it survives `wrangler types`.
declare namespace Cloudflare {
  interface Env {
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    VAPID_SUBJECT: string;
  }
}
