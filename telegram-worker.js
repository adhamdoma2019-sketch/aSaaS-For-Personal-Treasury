// Cloudflare Worker: sends a Telegram message when someone requests a withdrawal.
// Secrets/variables (Worker → Settings → Variables and Secrets):
//   TELEGRAM_BOT_TOKEN   (Secret)  from @BotFather
//   TELEGRAM_CHAT_ID     (Text)    your chat id
//   FIREBASE_PROJECT_ID  (Text)    asaas-for-personal-treasury
//
// The person's page sends {token, amount, method}. The Worker does NOT trust the
// name: it re-reads shares/{token} from Firestore (public get, same as the page),
// refuses unknown / revoked links, and takes the person's name from there.
// The amount is whatever the page sent (a notification only; the real request and
// the real amount are in your app, and nothing is paid until you approve).

const recent = new Map(); // best-effort rate limit per link, per Worker instance

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
    let body;
    try {
      body = JSON.parse(await request.text());
    } catch (e) {
      return new Response("bad request", { status: 400 });
    }
    const { token, amount, method } = body || {};
    const amt = Number(amount);
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(token) || !(amt > 0) || amt > 100000000) {
      return new Response("bad request", { status: 400 });
    }

    const now = Date.now();
    const hits = (recent.get(token) || []).filter((t) => now - t < 3600 * 1000);
    if (hits.length >= 10) return new Response("slow down", { status: 429 });
    recent.set(token, [...hits, now]);

    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/shares/${token}`;
    const r = await fetch(url);
    if (!r.ok) return new Response("unknown link", { status: 404 });
    const f = (await r.json()).fields || {};
    if (f.revoked && f.revoked.booleanValue) return new Response("unknown link", { status: 404 });
    const name = (f.personName && f.personName.stringValue) || "?";

    const text =
      "💸 طلب سحب جديد\n" +
      `الاسم: ${name}\n` +
      `المبلغ: ${amt.toLocaleString("en-US", { maximumFractionDigits: 2 })}\n` +
      `الطريقة: ${method === "transfer" ? "تحويل" : "كاش"}`;
    const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    return new Response(tg.ok ? "sent" : "telegram error", { status: tg.ok ? 200 : 502 });
  },
};
