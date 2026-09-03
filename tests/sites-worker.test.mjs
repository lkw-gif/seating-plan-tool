import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("requires an authenticated user for cloud plans", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/plans"),
    { DB: createMockDatabase(), ASSETS: createAssets() },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    message: "請先登入網站帳戶，才可以使用雲端方案。",
    code: "sign-in-required",
  });
});

test("keeps cloud plans private to the authenticated owner", async () => {
  const database = createMockDatabase();
  const environment = { DB: database, ASSETS: createAssets() };
  const planData = {
    className: "2B",
    students: [{ id: "student-1", number: "01" }],
    seats: [{ studentId: "student-1", locked: false, disabled: false }],
  };
  const createResponse = await worker.fetch(
    new Request("https://example.test/api/plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-id": "teacher-a",
      },
      body: JSON.stringify({ title: "2B 第一課節", data: planData }),
    }),
    environment,
  );

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.plan.title, "2B 第一課節");
  assert.deepEqual(created.plan.data, planData);

  const ownerList = await worker.fetch(
    new Request("https://example.test/api/plans", {
      headers: { "oai-authenticated-user-id": "teacher-a" },
    }),
    environment,
  );
  assert.equal((await ownerList.json()).plans.length, 1);

  const otherTeacherList = await worker.fetch(
    new Request("https://example.test/api/plans", {
      headers: { "oai-authenticated-user-id": "teacher-b" },
    }),
    environment,
  );
  assert.deepEqual((await otherTeacherList.json()).plans, []);

  const planId = created.plan.id;
  const otherTeacherRead = await worker.fetch(
    new Request(`https://example.test/api/plans/${planId}`, {
      headers: { "oai-authenticated-user-id": "teacher-b" },
    }),
    environment,
  );
  assert.equal(otherTeacherRead.status, 404);

  const updateResponse = await worker.fetch(
    new Request(`https://example.test/api/plans/${planId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-id": "teacher-a",
      },
      body: JSON.stringify({ title: "2B 第二課節", data: { ...planData, rows: 5 } }),
    }),
    environment,
  );
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).plan.title, "2B 第二課節");

  const deleteResponse = await worker.fetch(
    new Request(`https://example.test/api/plans/${planId}`, {
      method: "DELETE",
      headers: { "oai-authenticated-user-id": "teacher-a" },
    }),
    environment,
  );
  assert.deepEqual(await deleteResponse.json(), { deleted: true });
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

function createAssets() {
  return { fetch: async () => new Response("missing", { status: 404 }) };
}

function createMockDatabase() {
  const plans = new Map();
  return {
    async batch() {},
    prepare(sql) {
      return {
        bind(...parameters) {
          return {
            async all() {
              if (sql.includes("SELECT id, title, created_at")) {
                return {
                  results: [...plans.values()]
                    .filter((plan) => plan.owner_id === parameters[0])
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                    .map(({ id, title, created_at, updated_at }) => ({
                      id,
                      title,
                      created_at,
                      updated_at,
                    })),
                };
              }
              return { results: [] };
            },
            async first() {
              return [...plans.values()].find(
                (plan) => plan.owner_id === parameters[0] && plan.id === parameters[1],
              ) ?? null;
            },
            async run() {
              if (sql.startsWith("INSERT")) {
                const [id, owner_id, title, data_json, created_at, updated_at] = parameters;
                plans.set(id, { id, owner_id, title, data_json, created_at, updated_at });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE")) {
                const [title, data_json, updated_at, owner_id, id] = parameters;
                const plan = plans.get(id);
                if (!plan || plan.owner_id !== owner_id) return { meta: { changes: 0 } };
                plans.set(id, { ...plan, title, data_json, updated_at });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE")) {
                const [owner_id, id] = parameters;
                const plan = plans.get(id);
                if (!plan || plan.owner_id !== owner_id) return { meta: { changes: 0 } };
                plans.delete(id);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}
