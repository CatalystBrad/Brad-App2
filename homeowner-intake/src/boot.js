// Production readiness. The defaults in this codebase exist so a developer can
// run it with no setup; none of them may reach a server that holds a seller's
// disclosures. This is checked once at start-up and refuses to boot rather
// than warn, because a warning in a log nobody reads is the same as nothing.

export const PLACEHOLDERS = {
  LINK_SECRET: 'dev-secret-change-me',
  ADMIN_KEY: 'dev-admin-key',
  WA_VERIFY_TOKEN: 'dev-verify',
};

export const isProduction = (env = process.env) =>
  (env.APP_ENV ?? env.NODE_ENV ?? '').toLowerCase() === 'production';

/**
 * Returns { ok, problems, warnings }. `problems` stop the server; `warnings`
 * are printed and the server starts. Both are plain English so whoever is
 * deploying can act on them without reading the code.
 */
export function checkConfig(env = process.env) {
  const problems = [];
  const warnings = [];
  const prod = isProduction(env);

  const secret = env.LINK_SECRET ?? PLACEHOLDERS.LINK_SECRET;
  if (secret === PLACEHOLDERS.LINK_SECRET) {
    (prod ? problems : warnings).push('LINK_SECRET is the development placeholder. Every magic link and session cookie is signed with it. Set it to at least 32 random characters (e.g. `openssl rand -base64 48`).');
  } else if (secret.length < 32) {
    problems.push(`LINK_SECRET is only ${secret.length} characters. Use at least 32.`);
  }

  const admin = env.ADMIN_KEY ?? PLACEHOLDERS.ADMIN_KEY;
  if (admin === PLACEHOLDERS.ADMIN_KEY) {
    (prod ? problems : warnings).push('ADMIN_KEY is the development placeholder. It creates firms and triggers the worker. Set it to a long random value.');
  }

  if ((env.WA_VERIFY_TOKEN ?? PLACEHOLDERS.WA_VERIFY_TOKEN) === PLACEHOLDERS.WA_VERIFY_TOKEN && prod) {
    warnings.push('WA_VERIFY_TOKEN is the development placeholder. Meta uses it once, to confirm the webhook; set it to something random before registering the webhook.');
  }

  const baseUrl = env.BASE_URL ?? '';
  if (prod && !baseUrl) {
    problems.push('BASE_URL is not set. It is what goes into every magic link, and what Twilio signs against. Set it to the public https URL of this deployment.');
  } else if (prod && !baseUrl.startsWith('https://')) {
    problems.push(`BASE_URL is ${baseUrl}. In production it must be https: the session cookie is only marked Secure for an https BASE_URL, and sellers' answers must not travel in the clear.`);
  } else if (baseUrl.endsWith('/')) {
    problems.push('BASE_URL must not end with a slash - links and webhook signatures are built by appending paths to it.');
  }

  const dbPath = env.DB_PATH ?? ':memory:';
  if (prod && dbPath === ':memory:') {
    problems.push('DB_PATH is not set, so the database lives in memory and every seller\'s answers vanish on restart. Point it at a file on a persistent volume, e.g. /data/intake.db.');
  }

  if (prod && !env.WA_APP_SECRET) warnings.push('WA_APP_SECRET is not set: the WhatsApp webhook will refuse every call (503) until it is.');
  if (prod && !env.SMS_AUTH_TOKEN) warnings.push('SMS_AUTH_TOKEN is not set: the SMS webhook will refuse every call (503) until it is.');
  if (prod && !env.WA_TOKEN && !env.SMS_AUTH_TOKEN && !env.EMAIL_API_KEY) {
    warnings.push('No outbound credentials (WA_TOKEN, SMS_AUTH_TOKEN, EMAIL_API_KEY): every channel is in dry-run and nothing will actually be sent to a seller.');
  }
  if (prod && env.TRUST_PROXY !== '1') {
    warnings.push('TRUST_PROXY is not 1. Behind a load balancer every audit-trail IP will be the balancer\'s, not the seller\'s. Set TRUST_PROXY=1 if the app sits behind one (it does on Fly, Railway and Render).');
  }

  return { ok: problems.length === 0, problems, warnings, production: prod };
}

/** The address to record against an answer, honouring a trusted proxy. */
export function clientIp(req, env = process.env) {
  if (env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}
