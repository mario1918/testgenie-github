function encodeRfc3986(input) {
  return encodeURIComponent(input)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "%20");
}

function canonicalQueryStringFromUrl(url) {
  const entries = [];
  for (const [k, v] of url.searchParams.entries()) {
    entries.push([k, v]);
  }

  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  return entries.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join("&");
}

async function computeQsh(method, pathWithQuery) {
  const { createHash } = await import("crypto");
  const url = new URL(pathWithQuery, "https://example.invalid");
  const canonicalQuery = canonicalQueryStringFromUrl(url);
  const canonicalPath = url.pathname;
  const canonical = `${method.toUpperCase()}&${canonicalPath}&${canonicalQuery}`;
  return createHash("sha256").update(canonical).digest("hex");
}

class ZephyrHttpError extends Error {
  constructor(message, opts) {
    super(message);
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.responseText = opts.responseText;
  }
}

class ZephyrStubAdapter {
  async getTestStatus(_test) {
    return { status: "UNKNOWN" };
  }

  async getTestSteps(_test) {
    return [];
  }
}

class ZephyrSquadAdapter {
  constructor(cfg) {
    this.baseUrl = String(cfg.baseUrl || "").replace(/\/$/, "");
    this.accessKey = cfg.accessKey;
    this.secretKey = cfg.secretKey;
  }

  getBaseUrlCandidates() {
    const trimmed = this.baseUrl.replace(/\/$/, "");
    const noConnect = trimmed.replace(/\/connect$/i, "");
    return [...new Set([trimmed, noConnect])];
  }

  isRetryableNotFound(err) {
    if (!(err instanceof ZephyrHttpError)) return false;
    if (err.status === 404) return true;
    if (err.status === 400 && String(err.responseText || "").toLowerCase().includes("api not found")) return true;
    return false;
  }

  async request(method, path) {
    const { default: jwt } = await import("jsonwebtoken");
    const nowSec = Math.floor(Date.now() / 1000);

    const qsh = await computeQsh(method, path);
    const payload = {
      iss: this.accessKey,
      iat: nowSec,
      exp: nowSec + 60,
      qsh
    };

    const token = jwt.sign(payload, this.secretKey, { algorithm: "HS256" });

    let lastErr = undefined;

    for (const baseUrl of this.getBaseUrlCandidates()) {
      const url = `${baseUrl}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `JWT ${token}`,
          zapiAccessKey: this.accessKey,
          Accept: "application/json"
        }
      });

      if (res.ok) {
        return await res.json();
      }

      const text = await res.text().catch(() => "");
      const msg = `Zephyr Squad API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`;
      lastErr = new ZephyrHttpError(msg, { status: res.status, statusText: res.statusText, responseText: text });

      if (this.isRetryableNotFound(lastErr)) {
        continue;
      }

      throw lastErr;
    }

    throw lastErr ?? new Error(`Zephyr Squad API ${method} ${path} failed`);
  }

  normalizeExecutionsToStatus(data) {
    const uiExecutions = Array.isArray(data?.executions) ? data.executions : [];
    const uiNames = uiExecutions
      .map((e) => String(e?.execution?.status?.name ?? "").toUpperCase())
      .filter(Boolean);

    const flat = Array.isArray(data) ? data : data?.executions ?? data?.values ?? [];
    const flatNames = flat
      .map((e) => String(e?.status ?? e?.executionStatus ?? e?.statusName ?? "").toUpperCase())
      .filter(Boolean);

    const normalized = [...uiNames, ...flatNames];

    if (!normalized.length) return "UNKNOWN";
    if (normalized.some((s) => s.includes("FAIL"))) return "FAIL";
    if (normalized.some((s) => s.includes("PASS"))) return "PASS";
    return "UNKNOWN";
  }

  async getTestStatus(test) {
    const endpointBases = [
      "/public/rest/api/1.0/executions",
      "/public/rest/api/1.0/execution",
      "/public/rest/api/1.0/execution/search"
    ];

    const attempts = [];
    const errors = [];

    const buildPaths = (issueIdOrKey) => {
      const params = [];
      if (issueIdOrKey.issueId) params.push(`issueId=${encodeURIComponent(issueIdOrKey.issueId)}`);
      if (issueIdOrKey.issueKey) params.push(`issueKey=${encodeURIComponent(issueIdOrKey.issueKey)}`);
      if (test.projectId) params.push(`projectId=${encodeURIComponent(test.projectId)}`);
      params.push("offset=0");
      params.push("size=10");
      const qs = params.length ? `?${params.join("&")}` : "";
      return endpointBases.map((b) => `${b}${qs}`);
    };

    const candidatePaths = [
      ...(test.issueId ? buildPaths({ issueId: test.issueId }) : []),
      ...buildPaths({ issueKey: test.issueKey })
    ];

    try {
      for (const path of candidatePaths) {
        attempts.push(path);
        try {
          const data = await this.request("GET", path);
          const status = this.normalizeExecutionsToStatus(data);
          if (status !== "UNKNOWN") {
            return { status };
          }
        } catch (err) {
          if (this.isRetryableNotFound(err)) {
            errors.push(err?.message ?? String(err));
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      return {
        status: "UNKNOWN",
        error: `${msg}\nTried:\n${attempts.join("\n")}${errors.length ? `\n\nNotFound errors:\n${errors.join("\n")}` : ""}`
      };
    }

    return {
      status: "UNKNOWN",
      error: `No PASS/FAIL found. Tried:\n${attempts.join("\n")}${errors.length ? `\n\nNotFound errors:\n${errors.join("\n")}` : ""}`
    };
  }

  async getTestSteps(test) {
    if (!test.issueId || !test.projectId) {
      return [];
    }

    const path = `/public/rest/api/3.0/teststep/${encodeURIComponent(test.issueId)}?projectId=${encodeURIComponent(
      test.projectId
    )}&offsetOpt=0`;

    const data = await this.request("GET", path);
    const steps = Array.isArray(data?.testSteps)
      ? data.testSteps
      : Array.isArray(data?.steps)
        ? data.steps
        : Array.isArray(data)
          ? data
          : [];

    return steps.map((s) => ({
      id: s?.id ?? s?.stepId ?? s?.orderId,
      step: s?.step ?? s?.description ?? s?.stepDescription,
      data: s?.data ?? s?.testData,
      result: s?.result ?? s?.expectedResult,
      raw: s
    }));
  }
}

export function getZephyrAdapter(cfg) {
  if (!cfg.product) {
    return new ZephyrStubAdapter();
  }

  if (String(cfg.product).toLowerCase() === "squad") {
    if (!cfg.baseUrl || !cfg.accessKey || !cfg.secretKey) {
      return new ZephyrStubAdapter();
    }
    return new ZephyrSquadAdapter({ baseUrl: cfg.baseUrl, accessKey: cfg.accessKey, secretKey: cfg.secretKey });
  }

  return new ZephyrStubAdapter();
}
