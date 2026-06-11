/**
 * Netlify Function: /api/chat
 * API 代理 — 转发 DeepSeek Chat 请求，附加服务端 API Key，透传 SSE 流
 */

// 速率限制：IP → { count, resetTime }
const rateMap = new Map();
const RATE_LIMIT = 20;        // 每分钟最多 20 次
const RATE_WINDOW = 60_000;   // 窗口 60 秒

function checkRateLimit(clientIp) {
  const now = Date.now();
  const entry = rateMap.get(clientIp);
  if (!entry || now > entry.resetTime) {
    rateMap.set(clientIp, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

// 定期清理过期条目
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetTime) rateMap.delete(ip);
  }
}, 120_000).unref?.();

export default async function handler(request) {
  // ---------- CORS ----------
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonError(405, "仅支持 POST 请求");
  }

  // ---------- 速率限制 ----------
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-nf-client-connection-ip") ||
    "unknown";

  if (!checkRateLimit(clientIp)) {
    return jsonError(429, "请求过于频繁，请稍后再试");
  }

  // ---------- 解析请求体 ----------
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "请求体不是有效 JSON");
  }

  // 提取用户自定义 Key（如有）
  const userApiKey = payload._userApiKey?.trim();
  delete payload._userApiKey;

  // 服务端 Key
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();
  const apiKey = userApiKey || serverKey;

  if (!apiKey) {
    return jsonError(500, "未配置 API Key（服务端环境变量未设置且未提供用户 Key）");
  }

  // ---------- 转发到 DeepSeek API ----------
  let deepseekUrl = "https://api.deepseek.com/chat/completions";
  if (payload._baseUrl) {
    const base = payload._baseUrl.replace(/\/+$/, "");
    deepseekUrl = `${base}/chat/completions`;
    delete payload._baseUrl;
  }

  try {
    const upstream = await fetch(deepseekUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      let msg = text;
      try {
        msg = JSON.parse(text)?.error?.message || text;
      } catch {}
      return jsonError(upstream.status, msg);
    }

    // ---------- 透传 SSE 流 ----------
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-RateLimit-Remaining": String(
          Math.max(0, RATE_LIMIT - (rateMap.get(clientIp)?.count ?? 0))
        ),
      },
    });
  } catch (err) {
    return jsonError(502, `无法连接 DeepSeek API：${err.message}`);
  }
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
