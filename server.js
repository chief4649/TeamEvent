#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_RULES_PATH,
  DEFAULT_TRANSLATIONS_PATH,
  getProcessedMatches,
  readRules,
  readTranslations,
  renderOutput,
} = require("./extract_team_matches");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const TRANSLATIONS_PATH = path.join(DATA_DIR, "translations.ja.json");
const RULES_PATH = path.join(DATA_DIR, "rules.json");
const CACHE_DIR = path.join(DATA_DIR, ".cache");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);
const rateLimitStore = new Map();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFileFromDefault(targetPath, sourcePath) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureRuntimeFiles() {
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);
  ensureFileFromDefault(TRANSLATIONS_PATH, DEFAULT_TRANSLATIONS_PATH);
  ensureFileFromDefault(RULES_PATH, DEFAULT_RULES_PATH);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getClientIp(request) {
  if (TRUST_PROXY) {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function isRateLimited(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, startedAt: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function isAuthorized(request) {
  if (!ADMIN_TOKEN) {
    return true;
  }
  return getBearerToken(request) === ADMIN_TOKEN || request.headers["x-admin-token"] === ADMIN_TOKEN;
}

function requireAuthorization(request, response) {
  if (isAuthorized(request)) {
    return true;
  }
  sendJson(response, 401, {
    error: "Unauthorized",
  });
  return false;
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function serveFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".html"
    ? "text/html; charset=utf-8"
    : ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";

  sendText(response, 200, fs.readFileSync(filePath), contentType);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writePrettyJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseBoolean(value) {
  return value === "1" || value === "true";
}

function toOptionalNumber(value) {
  if (!value) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickFormat(searchParams) {
  const format = String(searchParams.get("format") || "ja").toLowerCase();
  if (["ja", "list", "json", "text"].includes(format)) {
    return format;
  }
  return "ja";
}

function buildOptions(searchParams) {
  const format = pickFormat(searchParams);

  return {
    event: searchParams.get("event"),
    gender: searchParams.get("gender") || null,
    round: searchParams.get("round") || null,
    team: searchParams.get("team") || null,
    contains: searchParams.get("contains") || null,
    docCode: searchParams.get("docCode") || null,
    limit: toOptionalNumber(searchParams.get("limit")),
    take: toOptionalNumber(searchParams.get("take")) || undefined,
    pretty: !parseBoolean(searchParams.get("compact")),
    list: format === "list",
    json: format === "json",
    ja: format === "ja",
    translations: TRANSLATIONS_PATH,
    rules: RULES_PATH,
    cacheDir: CACHE_DIR,
    refreshCache: parseBoolean(searchParams.get("refreshCache")),
  };
}

function createFriendlyErrorMessage(error) {
  const message = String(error?.message || "Unknown error");
  if (message.includes("fetch failed")) {
    return "WTT API への接続に失敗しました。少し待って再試行してください。";
  }
  if (message.includes("400 Bad Request")) {
    return "WTT API がこの条件を受け付けませんでした。eventId や取得時期を確認してください。";
  }
  return message;
}

function summarizeRounds(matches) {
  return [...new Set(matches.map((match) => match.roundLabel).filter(Boolean))];
}

async function handleApi(requestUrl, response) {
  try {
    const options = buildOptions(requestUrl.searchParams);
    if (!options.event) {
      sendJson(response, 400, {
        error: "event is required",
      });
      return;
    }

    const result = await getProcessedMatches(options);
    const output = renderOutput(result);
    sendJson(response, 200, {
      query: {
        event: options.event,
        gender: options.gender,
        round: options.round,
        team: options.team,
        contains: options.contains,
        docCode: options.docCode,
        limit: options.limit,
        format: pickFormat(requestUrl.searchParams),
        refreshCache: options.refreshCache,
      },
      meta: {
        fetchedMatches: result.normalized.length,
        returnedMatches: result.filtered.length,
        availableRounds: summarizeRounds(result.normalized),
      },
      output,
      matches: result.filtered,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: createFriendlyErrorMessage(error),
    });
  }
}

function handleConfigGet(request, response, pathname) {
  if (pathname === "/api/config/translations") {
    if (!requireAuthorization(request, response)) {
      return true;
    }
    sendJson(response, 200, {
      file: TRANSLATIONS_PATH,
      data: readTranslations(TRANSLATIONS_PATH),
    });
    return true;
  }

  if (pathname === "/api/config/rules") {
    if (!requireAuthorization(request, response)) {
      return true;
    }
    sendJson(response, 200, {
      file: RULES_PATH,
      data: readRules(RULES_PATH),
    });
    return true;
  }

  return false;
}

async function handleConfigUpdate(request, response, pathname) {
  if (!requireAuthorization(request, response)) {
    return true;
  }

  try {
    const rawBody = await readRequestBody(request);
    const parsed = JSON.parse(rawBody || "{}");

    if (pathname === "/api/config/translations") {
      writePrettyJson(TRANSLATIONS_PATH, parsed);
      sendJson(response, 200, {
        ok: true,
        file: TRANSLATIONS_PATH,
      });
      return true;
    }

    if (pathname === "/api/config/rules") {
      writePrettyJson(RULES_PATH, parsed);
      sendJson(response, 200, {
        ok: true,
        file: RULES_PATH,
      });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(response, 400, {
      error: `Invalid JSON: ${error.message}`,
    });
    return true;
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (isRateLimited(request)) {
    sendJson(response, 429, {
      error: "Too many requests",
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, adminProtected: Boolean(ADMIN_TOKEN) });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/team-matches") {
    handleApi(requestUrl, response);
    return;
  }

  if (request.method === "GET" && handleConfigGet(request, response, requestUrl.pathname)) {
    return;
  }

  if (request.method === "PUT") {
    handleConfigUpdate(request, response, requestUrl.pathname).then((handled) => {
      if (!handled) {
        sendJson(response, 404, { error: "Not found" });
      }
    });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const filePath = requestUrl.pathname === "/"
    ? path.join(PUBLIC_DIR, "index.html")
    : path.join(PUBLIC_DIR, requestUrl.pathname);
  serveFile(response, filePath);
});

ensureRuntimeFiles();

server.listen(PORT, HOST, () => {
  console.log(`WTT Team Match Formatter web server: http://${HOST}:${PORT}`);
});
