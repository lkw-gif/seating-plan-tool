import {
  findPlan,
  insertPlan,
  listPlans,
  removePlan,
  updatePlan,
} from "./storage.js";

const maxPlanBytes = 1_500_000;

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function getUserId(request) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || null;
}

function apiError(message, code, status) {
  return jsonResponse({ message, code }, status);
}

async function readPlanBody(request) {
  const rawBody = await request.text();
  if (!rawBody || new TextEncoder().encode(rawBody).length > maxPlanBytes) {
    throw new Error("方案資料太大，請減少名單或另存一份方案。");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("方案資料格式不正確。");
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) {
    throw new Error("請輸入 1 至 80 個字的方案名稱。");
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    throw new Error("找不到有效的座位表資料。");
  }

  const dataJson = JSON.stringify(body.data);
  if (new TextEncoder().encode(dataJson).length > maxPlanBytes) {
    throw new Error("方案資料太大，請減少名單或另存一份方案。");
  }
  return { title, dataJson };
}

function requireDatabase(env) {
  if (!env.DB) {
    return apiError("雲端儲存尚未設定，請使用已啟用雲端服務的網站。", "cloud-not-configured", 503);
  }
  return null;
}

async function handlePlans(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const userId = getUserId(request);
  if (!userId) {
    return apiError("請先登入網站帳戶，才可以使用雲端方案。", "sign-in-required", 401);
  }

  const databaseError = requireDatabase(env);
  if (databaseError) return databaseError;

  const segments = url.pathname.split("/").filter(Boolean);
  const planId = segments.length === 3 ? segments[2] : null;

  if (segments.length > 3 || (segments.length === 3 && !planId)) {
    return apiError("找不到此雲端方案。", "not-found", 404);
  }

  if (request.method === "GET" && !planId) {
    return jsonResponse({ plans: await listPlans(env.DB, userId) });
  }

  if (request.method === "POST" && !planId) {
    let body;
    try {
      body = await readPlanBody(request);
    } catch (error) {
      return apiError(error.message, "invalid-plan", 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const plan = await insertPlan(env.DB, {
      id,
      ownerId: userId,
      title: body.title,
      dataJson: body.dataJson,
      now,
    });
    return jsonResponse({ plan: serializePlan(plan) }, 201);
  }

  if (!planId) return apiError("找不到此雲端方案。", "not-found", 404);

  if (request.method === "GET") {
    const plan = await findPlan(env.DB, userId, planId);
    return plan
      ? jsonResponse({ plan: serializePlan(plan) })
      : apiError("找不到此雲端方案。", "not-found", 404);
  }

  if (request.method === "PUT") {
    let body;
    try {
      body = await readPlanBody(request);
    } catch (error) {
      return apiError(error.message, "invalid-plan", 400);
    }
    const plan = await updatePlan(env.DB, {
      id: planId,
      ownerId: userId,
      title: body.title,
      dataJson: body.dataJson,
      now: new Date().toISOString(),
    });
    return plan
      ? jsonResponse({ plan: serializePlan(plan) })
      : apiError("找不到此雲端方案。", "not-found", 404);
  }

  if (request.method === "DELETE") {
    const deleted = await removePlan(env.DB, userId, planId);
    return deleted
      ? jsonResponse({ deleted: true })
      : apiError("找不到此雲端方案。", "not-found", 404);
  }

  return apiError("不支援此操作。", "method-not-allowed", 405);
}

function serializePlan(plan) {
  if (!plan) return null;
  const data = JSON.parse(plan.data_json);
  return {
    id: plan.id,
    title: plan.title,
    data,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/plans" || url.pathname.startsWith("/api/plans/")) {
      try {
        return await handlePlans(request, env, url);
      } catch {
        return apiError("雲端方案暫時未能使用，請稍後再試。", "cloud-error", 500);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
