const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleJwksEndpoint = "https://www.googleapis.com/oauth2/v3/certs";

const sessionCookieName = "__Host-seating_google_session";
const stateCookieName = "__Host-seating_google_state";
const verifierCookieName = "__Host-seating_google_verifier";
const nonceCookieName = "__Host-seating_google_nonce";
const returnCookieName = "__Host-seating_google_return";
const sessionMaxAge = 60 * 60 * 24 * 7;
const oauthMaxAge = 60 * 10;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value) {
  return encodeBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(textDecoder.decode(decodeBase64Url(value)));
}

function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

function parseCookies(request) {
  const cookies = new Map();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

function makeCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return makeCookie(name, "", 0);
}

function redirect(location, cookies = []) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function sanitizeReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.replace(/[\r\n]/g, "");
}

function getRedirectUri(request, env) {
  if (env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI;
  return `${new URL(request.url).origin}/api/auth/google/callback`;
}

function getAllowedDomains(env) {
  return String(env.GOOGLE_ALLOWED_DOMAIN || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function getSessionSecret(env) {
  const secret = String(env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET is not configured");
  return secret;
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function createSessionToken(user, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = encodeJson({
    sub: user.sub,
    email: user.email,
    name: user.name || user.email,
    picture: user.picture || "",
    hd: user.hd || "",
    iat: issuedAt,
    exp: issuedAt + sessionMaxAge,
  });
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function readSessionToken(token, secret) {
  try {
    const [payloadPart, signaturePart, extra] = String(token || "").split(".");
    if (!payloadPart || !signaturePart || extra) return null;
    const key = await importHmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signaturePart),
      textEncoder.encode(payloadPart),
    );
    if (!valid) return null;
    const payload = decodeJson(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.email || !payload.exp || payload.exp <= now) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name || payload.email),
      picture: String(payload.picture || ""),
      hd: String(payload.hd || ""),
    };
  } catch {
    return null;
  }
}

export function isGoogleAuthConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && String(env.SESSION_SECRET || "").length >= 32);
}

export async function getGoogleUser(request, env) {
  if (!isGoogleAuthConfigured(env)) return null;
  const token = parseCookies(request).get(sessionCookieName);
  return readSessionToken(token, getSessionSecret(env));
}

async function verifyGoogleIdToken(idToken, env, expectedNonce) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Google ID token");
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid Google token header");

  const jwksResponse = await fetch(googleJwksEndpoint, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!jwksResponse.ok) throw new Error("Unable to load Google signing keys");
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new Error("Google signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    textEncoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) throw new Error("Invalid Google token signature");

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!["https://accounts.google.com", "accounts.google.com"].includes(payload.iss)) {
    throw new Error("Invalid Google token issuer");
  }
  if (!audience.includes(env.GOOGLE_CLIENT_ID)) throw new Error("Invalid Google token audience");
  if (!payload.exp || payload.exp <= now - 60 || payload.iat > now + 300) {
    throw new Error("Expired Google token");
  }
  if (payload.nonce !== expectedNonce) throw new Error("Invalid Google token nonce");
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Google email is not verified");
  }

  const allowedDomains = getAllowedDomains(env);
  const accountDomain = String(payload.hd || payload.email.split("@").pop() || "").toLowerCase();
  if (allowedDomains.length && !allowedDomains.includes(accountDomain)) {
    const error = new Error("This Google account is not in the allowed school domain");
    error.code = "domain-not-allowed";
    throw error;
  }

  return {
    sub: String(payload.sub),
    email: String(payload.email),
    name: String(payload.name || payload.email),
    picture: String(payload.picture || ""),
    hd: String(payload.hd || ""),
  };
}

function oauthCookiesToClear() {
  return [stateCookieName, verifierCookieName, nonceCookieName, returnCookieName].map(clearCookie);
}

async function startGoogleLogin(request, env, url) {
  if (!isGoogleAuthConfigured(env)) {
    return jsonResponse(
      { message: "Google 登入尚未完成設定。", code: "google-auth-not-configured" },
      503,
    );
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") || "/");
  const authorizationUrl = new URL(googleAuthorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(request, env),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: encodeBase64Url(await sha256(verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  return redirect(authorizationUrl.toString(), [
    makeCookie(stateCookieName, state, oauthMaxAge),
    makeCookie(verifierCookieName, verifier, oauthMaxAge),
    makeCookie(nonceCookieName, nonce, oauthMaxAge),
    makeCookie(returnCookieName, returnTo, oauthMaxAge),
  ]);
}

async function finishGoogleLogin(request, env, url) {
  const cookies = parseCookies(request);
  const returnTo = sanitizeReturnTo(cookies.get(returnCookieName) || "/");
  const failureUrl = new URL(returnTo, request.url);
  failureUrl.searchParams.set("google_login", "error");
  const cleanupCookies = oauthCookiesToClear();

  try {
    if (!isGoogleAuthConfigured(env)) throw new Error("Google auth is not configured");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookies.get(stateCookieName);
    const verifier = cookies.get(verifierCookieName);
    const nonce = cookies.get(nonceCookieName);
    if (!code || !state || !expectedState || state !== expectedState || !verifier || !nonce) {
      throw new Error("Invalid OAuth callback state");
    }

    const tokenResponse = await fetch(googleTokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(request, env),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.id_token) throw new Error("Google token exchange failed");

    const user = await verifyGoogleIdToken(tokenPayload.id_token, env, nonce);
    const sessionToken = await createSessionToken(user, getSessionSecret(env));
    const successUrl = new URL(returnTo, request.url);
    successUrl.searchParams.set("google_login", "success");
    return redirect(successUrl.toString(), [
      ...cleanupCookies,
      makeCookie(sessionCookieName, sessionToken, sessionMaxAge),
    ]);
  } catch (error) {
    if (error?.code === "domain-not-allowed") {
      failureUrl.searchParams.set("reason", "domain-not-allowed");
    }
    return redirect(failureUrl.toString(), cleanupCookies);
  }
}

export async function handleGoogleAuth(request, env, url) {
  if (url.pathname === "/api/auth/google/start" && request.method === "GET") {
    return startGoogleLogin(request, env, url);
  }
  if (url.pathname === "/api/auth/google/callback" && request.method === "GET") {
    return finishGoogleLogin(request, env, url);
  }
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    if (!isGoogleAuthConfigured(env)) {
      return jsonResponse(
        { message: "Google 登入尚未完成設定。", code: "google-auth-not-configured" },
        503,
      );
    }
    const user = await getGoogleUser(request, env);
    return user
      ? jsonResponse({ user })
      : jsonResponse({ message: "請先使用 Google 登入。", code: "sign-in-required" }, 401);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return new Response(JSON.stringify({ signedOut: true }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": clearCookie(sessionCookieName),
      },
    });
  }
  return jsonResponse({ message: "找不到此登入功能。", code: "not-found" }, 404);
}
