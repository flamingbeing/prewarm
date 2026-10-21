var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/routes.js
var SITES = {
  // the prewarming study app at the root; /prewarm-update/ is its "won't update" helper page (also at
  // anawj.com/prewarm-update/ until every phone has moved off the old address)
  "prewarmstudy.anawj.com": { root: "prewarm/", prefixes: { "/prewarm-update/": "prewarm-update/" } }
};
var SHARED = [];
var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
function resolve(host, pathname) {
  const out = route(host, pathname);
  return out.file != null && /%2e|%2f|%5c|\\|(^|\/)\.\.?(\/|$)/i.test(out.file) ? { notFound: true } : out;
}
__name(resolve, "resolve");
function route(host, pathname) {
  host = String(host || "").toLowerCase().replace(/:\d+$/, "");
  const site = SITES[host], p = pathname;
  if (!site) return LOCAL.test(host) ? { file: p.replace(/^\//, "") } : { notFound: true };
  for (const dir of SHARED) {
    if (p === dir.slice(0, -1)) return { redirect: dir };
    if (p.startsWith(dir)) return { file: p.slice(1) };
  }
  if (site.moved) {
    for (const [prefix, to] of Object.entries(site.moved)) {
      if (p === prefix.slice(0, -1) || p.startsWith(prefix)) return { redirect: to + p.slice(prefix.length) };
    }
    return { notFound: true };
  }
  for (const [prefix, folder] of Object.entries(site.root ? site.prefixes || {} : {})) {
    if (p.startsWith(prefix)) return { file: folder + p.slice(prefix.length) };
  }
  if (site.root) {
    const own = "/" + site.root;
    if (p === own.slice(0, -1)) return { redirect: own };
    if (p.startsWith(own)) return { file: site.root + p.slice(own.length) };
    return { file: site.root + p.replace(/^\//, "") };
  }
  for (const [prefix, folder] of Object.entries(site.prefixes || {})) {
    if (p === prefix.slice(0, -1)) return { redirect: prefix };
    if (p.startsWith(prefix)) return { file: folder + p.slice(prefix.length) };
  }
  return { notFound: true };
}
__name(route, "route");

// worker/access.js
var certs = null;
var certsAt = 0;
var b64u = /* @__PURE__ */ __name((s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0)), "b64u");
async function verifyAccess(token, env, fetchImpl = fetch, now = Date.now()) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let head, claims;
  try {
    head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
  } catch (e) {
    return null;
  }
  if (head.alg !== "RS256") return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || !(claims.exp * 1e3 > now)) return null;
  if (claims.iss && claims.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
  if (!certs || now - certsAt > 36e5) {
    const r = await fetchImpl(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!r.ok) return null;
    certs = (await r.json()).keys || [];
    certsAt = now;
  }
  const jwk = certs.find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  return ok ? claims.email || "signed in" : null;
}
__name(verifyAccess, "verifyAccess");

// worker/scan.js
var SCAN_HOST = "prewarmstudy.anawj.com";
var SCAN_PREFIX = "/scan-api/";
var MAX_PHOTO = 12 * 1024 * 1024;
var SCAN_ID = /^[A-Za-z0-9-]{8,64}$/;
var PAGE = /^(?:[1-9]|1[0-4]|x)$/;
var SUBJECT = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,39}$/;
var json = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }), "json");
async function handleScan(request, env, fetchImpl = fetch) {
  const missing = ["ACCESS_TEAM", "SCAN_ACCESS_AUD", "SCAN_ORIGIN", "SCAN_CLIENT_ID", "SCAN_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) return json({ error: `Scan upload is not set up yet: the Worker has no ${missing.join(", ")}.` }, 503);
  const email = await verifyAccess(request.headers.get("Cf-Access-Jwt-Assertion"), { ACCESS_TEAM: env.ACCESS_TEAM, ACCESS_AUD: env.SCAN_ACCESS_AUD }, fetchImpl);
  if (!email) return json({ error: "Sign in first." }, 401);
  const url = new URL(request.url), parts = url.pathname.slice(SCAN_PREFIX.length).split("/");
  let path;
  if (request.method === "GET" && parts.length === 1 && parts[0] === "whoami") return json({ email });
  if (request.method === "GET" && parts.length === 2 && parts[0] === "status" && SCAN_ID.test(parts[1])) path = `status/${parts[1]}`;
  else if (request.method === "POST" && parts.length === 3 && parts[0] === "upload" && SCAN_ID.test(parts[1]) && PAGE.test(parts[2])) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== `https://${SCAN_HOST}`) return json({ error: "Wrong origin." }, 403);
    const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png") return json({ error: "A JPEG or PNG photo only." }, 415);
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: "Empty photo." }, 400);
    if (body.byteLength > MAX_PHOTO) return json({ error: "That photo is too big (12 MB at most)." }, 413);
    const subject = (request.headers.get("X-Scan-Subject") || "").trim();
    if (subject && !SUBJECT.test(subject)) return json({ error: "The Subject ID can only have letters, numbers, spaces and - _ . /" }, 400);
    return pass(fetchImpl, env, `upload/${parts[1]}/${parts[2]}`, { method: "POST", body, headers: { "Content-Type": type, ...subject && { "X-Scan-Subject": subject } } }, email);
  } else return json({ error: "Not found." }, 404);
  return pass(fetchImpl, env, path, { method: "GET" }, email);
}
__name(handleScan, "handleScan");
async function pass(fetchImpl, env, path, init, email) {
  let res;
  try {
    res = await fetchImpl(`${env.SCAN_ORIGIN.replace(/\/+$/, "")}/scan-api/${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...init.headers, "CF-Access-Client-Id": env.SCAN_CLIENT_ID, "CF-Access-Client-Secret": env.SCAN_CLIENT_SECRET, "X-Scan-User": email }
    });
  } catch (e) {
    return json({ error: "The study computer did not answer." }, 502);
  }
  if (res.status >= 300 && res.status < 400) return json({ error: "The study computer refused the request (check its Access policy)." }, 502);
  if (res.status === 403 || res.status === 401) return json({ error: "The study computer refused the request (check its service token)." }, 502);
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch (e) {
    return json({ error: `The study computer said ${res.status}.` }, 502);
  }
  return json(out, res.status);
}
__name(pass, "pass");

// worker/sites.js
var NOINDEX = "noindex, nofollow";
var sites_default = {
  async fetch(request, env) {
    const u0 = new URL(request.url);
    if (u0.hostname === SCAN_HOST && u0.pathname.startsWith(SCAN_PREFIX)) return handleScan(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
    const r = resolve(url.hostname, url.pathname);
    if (r.redirect) return redirect(url, r.redirect);
    if (r.notFound) return notFound();
    let file = r.file;
    if (file === "" || file.endsWith("/")) file += "index.html";
    let res = await asset(env, url, file);
    if (res.status === 404 && !/\.[^/]+$/.test(file)) {
      const dir = await asset(env, url, file + "/index.html");
      if (dir.status === 200) return redirect(url, url.pathname + "/");
    }
    if (res.status === 404) return notFound();
    res = new Response(res.body, res);
    res.headers.set("X-Robots-Tag", NOINDEX);
    return res;
  }
};
var asset = /* @__PURE__ */ __name((env, url, file) => env.ASSETS.fetch(new Request(new URL("/" + file, url), { method: "GET" })), "asset");
var redirect = /* @__PURE__ */ __name((url, path) => Response.redirect(new URL(path + url.search, url).toString(), 301), "redirect");
var notFound = /* @__PURE__ */ __name(() => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": NOINDEX } }), "notFound");

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
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

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
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
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-qYM0lI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = sites_default;

// ../../../root/.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
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

// .wrangler/tmp/bundle-qYM0lI/middleware-loader.entry.ts
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
//# sourceMappingURL=sites.js.map
