const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "543574921019-a5ispp5ri1jvc60avdcjpu5ebr1s461f.apps.googleusercontent.com";
const GOOGLE_ALLOWED_DOMAIN = "keilong.edu.hk";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const GOOGLE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const APP_PROPERTY_KEY = "seatingPlanTool";
const APP_PROPERTY_VALUE = "cloud-plan";

let accessToken = "";
let tokenExpiresAt = 0;
let cloudAccount = null;
let identityScriptPromise = null;
let tokenClient = null;
let tokenRequestPromise = null;

function cloudError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clearSession() {
  accessToken = "";
  tokenExpiresAt = 0;
  cloudAccount = null;
}

function hasActiveToken() {
  return Boolean(accessToken) && Date.now() < tokenExpiresAt - 60_000;
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing || document.createElement("script");

    const handleLoad = () => resolve();
    const handleError = () => {
      identityScriptPromise = null;
      reject(cloudError("未能載入 Google 登入服務，請檢查網絡後再試。", "network-unavailable"));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return identityScriptPromise;
}

async function requestAccessToken(prompt = "") {
  if (hasActiveToken()) return accessToken;
  if (tokenRequestPromise) return tokenRequestPromise;
  await loadGoogleIdentity();

  tokenRequestPromise = new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      tokenRequestPromise = null;
      reject(cloudError("Google 登入視窗未有回應，請再試一次。", "sign-in-required", 401));
    }, 30_000);

    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPE,
        callback: () => {},
        error_callback: () => {},
      });
    }

    tokenClient.callback = (response) => {
      window.clearTimeout(timeoutId);
      tokenRequestPromise = null;
      if (!response?.access_token || response.error) {
        reject(cloudError("Google 登入未能完成，請再試一次。", "sign-in-required", 401));
        return;
      }
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
      resolve(accessToken);
    };
    tokenClient.error_callback = () => {
      window.clearTimeout(timeoutId);
      tokenRequestPromise = null;
      reject(cloudError("Google 登入視窗已關閉，請再試一次。", "sign-in-required", 401));
    };
    tokenClient.requestAccessToken({ prompt });
  });

  return tokenRequestPromise;
}

async function googleRequest(url, options = {}) {
  if (!hasActiveToken()) {
    throw cloudError("請先使用 Google 登入，才可以使用雲端方案。", "sign-in-required", 401);
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
  } catch {
    throw cloudError("未能連接 Google Drive，請檢查網絡後再試。", "network-unavailable");
  }

  if (response.status === 401) {
    clearSession();
    throw cloudError("Google 登入已逾時，請重新登入。", "sign-in-required", 401);
  }
  if (!response.ok) {
    let message = "Google Drive 暫時未能使用，請稍後再試。";
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {
      // Keep the clear fallback message for non-JSON errors.
    }
    throw cloudError(message, "drive-error", response.status);
  }
  return response;
}

async function loadAccount() {
  const response = await googleRequest("https://openidconnect.googleapis.com/v1/userinfo");
  const profile = await response.json();
  const domain = String(profile.email || "").split("@")[1]?.toLowerCase();
  if (!profile.email_verified || domain !== GOOGLE_ALLOWED_DOMAIN) {
    const token = accessToken;
    clearSession();
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }
    throw cloudError("請使用獲准的學校 Google 帳戶登入。", "domain-not-allowed", 403);
  }

  cloudAccount = {
    id: profile.sub,
    name: profile.name || profile.email,
    email: profile.email,
    picture: profile.picture || "",
  };
  return cloudAccount;
}

async function readPlanFile(file) {
  const response = await googleRequest(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
  const payload = await response.json();
  return {
    id: file.id,
    title: payload.title || "未命名方案",
    data: payload.data,
    createdAt: payload.createdAt || file.createdTime,
    updatedAt: payload.updatedAt || file.modifiedTime,
  };
}

function createMultipartBody(metadata, payload) {
  const boundary = `seat-plan-${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { boundary, body };
}

function safeFileName(title) {
  const name = title.replace(/[\\/:*?"<>|]/g, "-").trim() || "座位表";
  return `${name.slice(0, 80)}.seating-plan.json`;
}

async function uploadPlan({ id = "", title, data, createdAt }) {
  const now = new Date().toISOString();
  const payload = {
    title,
    data,
    createdAt: createdAt || now,
    updatedAt: now,
  };
  const metadata = {
    name: safeFileName(title),
    mimeType: "application/json",
    appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE },
    ...(!id ? { parents: ["appDataFolder"] } : {}),
  };
  const { boundary, body } = createMultipartBody(metadata, payload);
  const url = id
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,createdTime,modifiedTime`
    : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,createdTime,modifiedTime`;
  const response = await googleRequest(url, {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await response.json();
  return {
    plan: {
      id: file.id,
      title,
      data,
      createdAt: payload.createdAt || file.createdTime,
      updatedAt: payload.updatedAt || file.modifiedTime,
    },
  };
}

export async function signInCloudAccount() {
  await requestAccessToken("select_account");
  return { user: await loadAccount() };
}

export async function getCloudAccount() {
  if (!hasActiveToken() || !cloudAccount) {
    throw cloudError("請先使用 Google 登入，才可以使用雲端方案。", "sign-in-required", 401);
  }
  return { user: cloudAccount };
}

export async function signOutCloudAccount() {
  const token = accessToken;
  clearSession();
  if (token && window.google?.accounts?.oauth2) {
    await new Promise((resolve) => window.google.accounts.oauth2.revoke(token, resolve));
  }
  return { signedOut: true };
}

export async function listCloudPlans() {
  const query = encodeURIComponent(
    `trashed = false and appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' }`,
  );
  const fields = encodeURIComponent("files(id,name,createdTime,modifiedTime)");
  const response = await googleRequest(
    `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=100`,
  );
  const payload = await response.json();
  const plans = (await Promise.all((payload.files || []).map(readPlanFile)))
    .filter((plan) => plan.data && typeof plan.data === "object")
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return { plans };
}

export function createCloudPlan(title, data) {
  return uploadPlan({ title, data });
}

export async function updateCloudPlan(id, title, data) {
  const current = await getCloudPlan(id);
  return uploadPlan({ id, title, data, createdAt: current.plan.createdAt });
}

export async function getCloudPlan(id) {
  const response = await googleRequest(
    `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,createdTime,modifiedTime`,
  );
  const file = await response.json();
  return { plan: await readPlanFile(file) };
}

export async function deleteCloudPlan(id) {
  await googleRequest(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  return { deleted: true };
}

if (typeof window !== "undefined") {
  loadGoogleIdentity().catch(() => {});
}
