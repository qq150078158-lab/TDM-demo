// api/proxy.js
export const config = {
    maxDuration: 60,
};

export default async function handler(request, response) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    // 1. 仅允许 POST 请求
    if (request.method !== 'POST') {
        response.status(405).json({ detail: 'Method Not Allowed' });
        return;
    }

    // 2. 环境变量
    const HF_API_URL = process.env.HF_API_URL;
    const hfToken = process.env.HF_ACCESS_TOKEN;

    if (!HF_API_URL || !hfToken) {
        console.error("Vercel 环境变量 HF_API_URL 或 HF_ACCESS_TOKEN 未设置");
        response.status(500).json({ detail: "服务器代理配置错误" });
        return;
    }

    // --- 打印目标 URL ---
    console.log(`[Proxy] 正在转发 POST 请求至: ${HF_API_URL}`);

    // 3. 用 AbortController 控制 fetch 超时
    const controller = new AbortController();
    const timeoutMs = 55_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // 4. 强制 source='web'
        const modifiedBody = {
            ...(request.body || {}),
            source: 'web'
        };

        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${hfToken}`
            },
            body: JSON.stringify(modifiedBody),
            signal: controller.signal,
        });

        clearTimeout(timer);

        const contentType = hfResponse.headers.get("content-type") || "";

        // 5a. 成功：2xx + JSON
        if (hfResponse.ok && contentType.includes("application/json")) {
            const data = await hfResponse.json();
            console.log("[Proxy] HF 返回 JSON，回传前端");
            response.status(200).json(data);
            return;
        }

        // 5b. 其他情况（非 2xx，或非 JSON），一律以 JSON 形式回传
        const errorText = await hfResponse.text();
        console.error(`[Proxy] HF 异常: status=${hfResponse.status}, ct=${contentType}`);
        console.error(`[Proxy] HF 响应片段: ${errorText.substring(0, 200)}...`);

        // 把 HF 的状态码透传，但 body 保证是 JSON
        response.status(hfResponse.status || 502).json({
            detail: hfResponse.ok
                ? "代理错误：后端(HF)返回了非JSON格式的成功响应"
                : `Hugging Face API Error (Status ${hfResponse.status})`,
            hf_response_body: errorText.substring(0, 2000),
        });

    } catch (error) {
        clearTimeout(timer);

        // 6. 超时 / 网络错误 / TLS 错误，都返回 JSON，绝不透传 HTML
        if (error.name === 'AbortError') {
            console.error(`[Proxy] HF fetch 超时（>${timeoutMs}ms）`);
            response.status(504).json({
                detail: `代理请求后端(Hugging Face)超时（>${timeoutMs / 1000}s）。` +
                        `HF 免费 Space 可能正在冷启动，请 1 分钟后重试。`
            });
            return;
        }

        console.error("[Proxy] fetch 失败:", error);
        if (error.cause) {
            console.error("[Proxy] cause:", error.cause);
        }

        const isFetchFail = (error.message || '').includes('fetch failed');
        response.status(500).json({
            detail: isFetchFail
                ? "代理请求后端(Hugging Face)失败（网络/TLS 错误）。可能正在冷启动，请 1 分钟后重试。"
                : `代理服务器内部错误: ${error.message}`
        });
    }
}

