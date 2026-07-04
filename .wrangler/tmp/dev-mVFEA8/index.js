var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
__name(json, "json");
function getClientMeta(request) {
  return {
    user_agent: request.headers.get("User-Agent") || "",
    ip_address: request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || ""
  };
}
__name(getClientMeta, "getClientMeta");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          success: true,
          message: "Liwox Forms API is live"
        });
      }
      if (request.method === "POST" && url.pathname === "/api/leads") {
        const body = await request.json();
        const meta = getClientMeta(request);
        const {
          campaign_key,
          page_key,
          form_key,
          full_name,
          email,
          phone,
          company,
          message,
          source,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_term,
          utm_content,
          referrer
        } = body;
        if (!email && !phone) {
          return json({
            success: false,
            error: "Email or phone is required"
          }, 400);
        }
        let campaign = null;
        let page = null;
        let form = null;
        if (campaign_key) {
          campaign = await env.DB.prepare(
            "SELECT id FROM campaigns WHERE campaign_key = ?"
          ).bind(campaign_key).first();
        }
        if (page_key) {
          page = await env.DB.prepare(
            "SELECT id FROM pages WHERE page_key = ?"
          ).bind(page_key).first();
        }
        if (form_key) {
          form = await env.DB.prepare(
            "SELECT id FROM forms WHERE form_key = ?"
          ).bind(form_key).first();
        }
        const leadResult = await env.DB.prepare(`
            INSERT INTO leads (
              campaign_id,
              page_id,
              form_id,
              full_name,
              email,
              phone,
              company,
              message,
              source,
              utm_source,
              utm_medium,
              utm_campaign,
              utm_term,
              utm_content,
              referrer,
              user_agent,
              ip_address,
              raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
          campaign?.id || null,
          page?.id || null,
          form?.id || null,
          full_name || null,
          email || null,
          phone || null,
          company || null,
          message || null,
          source || null,
          utm_source || null,
          utm_medium || null,
          utm_campaign || null,
          utm_term || null,
          utm_content || null,
          referrer || null,
          meta.user_agent,
          meta.ip_address,
          JSON.stringify(body)
        ).run();
        const leadId = leadResult.meta.last_row_id;
        await env.DB.prepare(`
            INSERT INTO submissions (
              campaign_id,
              page_id,
              form_id,
              lead_id,
              submission_type,
              raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
          campaign?.id || null,
          page?.id || null,
          form?.id || null,
          leadId,
          "lead",
          JSON.stringify(body)
        ).run();
        await env.DB.prepare(`
            INSERT INTO events (
              lead_id,
              event_type,
              event_data
            ) VALUES (?, ?, ?)
          `).bind(
          leadId,
          "lead_created",
          JSON.stringify({
            source: source || null,
            page_key: page_key || null,
            form_key: form_key || null
          })
        ).run();
        return json({
          success: true,
          message: "Lead captured successfully",
          lead_id: leadId
        }, 201);
      }
      if (request.method === "GET" && url.pathname === "/api/leads") {
        const leads = await env.DB.prepare(`
            SELECT
              leads.id,
              leads.full_name,
              leads.email,
              leads.phone,
              leads.company,
              leads.source,
              leads.status,
              leads.created_at,
              campaigns.name AS campaign_name,
              pages.title AS page_title,
              forms.name AS form_name
            FROM leads
            LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
            LEFT JOIN pages ON pages.id = leads.page_id
            LEFT JOIN forms ON forms.id = leads.form_id
            ORDER BY leads.created_at DESC
            LIMIT 100
          `).all();
        return json({
          success: true,
          leads: leads.results
        });
      }
      return json({
        success: false,
        error: "Route not found"
      }, 404);
    } catch (error) {
      return json({
        success: false,
        error: error.message || "Server error"
      }, 500);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-jKfinI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-jKfinI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
