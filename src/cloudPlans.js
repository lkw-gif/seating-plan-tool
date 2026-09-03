async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    const error = new Error("未能連接雲端服務");
    error.code = "network-unavailable";
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the status-based error when the server did not return JSON.
  }

  if (!response.ok) {
    const error = new Error(payload?.message || "雲端服務暫時未能使用");
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }

  return payload;
}

export function listCloudPlans() {
  return request("/api/plans");
}

export function createCloudPlan(title, data) {
  return request("/api/plans", {
    method: "POST",
    body: JSON.stringify({ title, data }),
  });
}

export function updateCloudPlan(id, title, data) {
  return request(`/api/plans/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ title, data }),
  });
}

export function getCloudPlan(id) {
  return request(`/api/plans/${encodeURIComponent(id)}`);
}

export function deleteCloudPlan(id) {
  return request(`/api/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getCloudAccount() {
  return request("/api/auth/me");
}

export function signOutCloudAccount() {
  return request("/api/auth/logout", { method: "POST" });
}

export function getGoogleSignInUrl(returnTo = "/") {
  return `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}
