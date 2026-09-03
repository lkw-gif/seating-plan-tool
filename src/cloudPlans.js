const plansPath = "/api/plans";

async function request(path = "", options = {}) {
  let response;
  try {
    response = await fetch(`${plansPath}${path}`, {
      ...options,
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
  return request();
}

export function createCloudPlan(title, data) {
  return request("", {
    method: "POST",
    body: JSON.stringify({ title, data }),
  });
}

export function updateCloudPlan(id, title, data) {
  return request(`/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ title, data }),
  });
}

export function getCloudPlan(id) {
  return request(`/${encodeURIComponent(id)}`);
}

export function deleteCloudPlan(id) {
  return request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}
