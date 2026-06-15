import { useState, useEffect, useMemo } from "react";

// ─── ⚙️ REAL ALERT CONFIGURATION ─────────────────────────────────────────────
//
// ── EMAIL (EmailJS) ──────────────────────────────────────────────────────────
// 1. Go to https://www.emailjs.com/ and create a free account
// 2. Create an Email Service (Gmail, Outlook, etc.)
// 3. Create an Email Template with variables: {{order_id}}, {{customer}},
//    {{alert_type}}, {{message}}, {{store}}, {{timestamp}}
// 4. Fill in the values below:
const EMAILJS_CONFIG = {
  serviceId: "",   // e.g. "service_abc123"
  templateId: "", // e.g. "template_xyz789"
  publicKey: "",   // e.g. "AbCdEfGhIjKlMnOp"
  toEmail: "",    // Recipient email
};

//
// ── Twilio Setup ─────────────────────────────────────────────────────────────
// 1. Sign up at https://www.twilio.com (free trial gives $15 credit)
// 2. Go to Messaging → Try it Out → Send a WhatsApp message
// 3. Join the sandbox by sending "join <your-sandbox-word>" to +1 415 523 8886
// 4. Fill in the values below:
const TWILIO_CONFIG = {
  // accountSid: "",   // Starts with "AC..."
  // authToken: "",
  // fromNumber: "",      // Twilio sandbox number
  // toNumbers: [
  //   "whatsapp:",               // Add your ops team numbers here
  //   "whatsapp:"
  // ],
};

const WHATSAPP_MODE = "direct"; // "direct" | "relay" | "disabled"
const RELAY_URL = ""; // Only for "relay" mode

// ─────────────────────────────────────────────────────────────────────────────

// ─── REAL ALERT SENDERS ───────────────────────────────────────────────────────

// Load EmailJS SDK dynamically
const loadEmailJS = () => {
  return new Promise((resolve, reject) => {
    if (window.emailjs) return resolve(window.emailjs);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => {
      window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
      resolve(window.emailjs);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const sendRealEmail = async (alert) => {
  const isConfigured =
    EMAILJS_CONFIG.serviceId !== "YOUR_EMAILJS_SERVICE_ID" &&
    EMAILJS_CONFIG.templateId !== "YOUR_EMAILJS_TEMPLATE_ID" &&
    EMAILJS_CONFIG.publicKey !== "YOUR_EMAILJS_PUBLIC_KEY";

  if (!isConfigured) {
    return {
      success: false,
      error: "EmailJS not configured. Fill in EMAILJS_CONFIG at the top of the file.",
    };
  }

  try {
    const ejs = await loadEmailJS();
    await ejs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email: EMAILJS_CONFIG.toEmail,
      order_id: alert.orderId || "N/A",
      customer: alert.customer || "Unknown",
      alert_type: alert.type,
      message: alert.message,
      store: alert.store || "All Stores",
      severity: alert.severity?.toUpperCase() || "UNKNOWN",
      timestamp: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.text || err?.message || "EmailJS send failed" };
  }
};

const sendRealWhatsApp = async (alert) => {
  if (WHATSAPP_MODE === "disabled") {
    return { success: false, error: "WhatsApp disabled. Set WHATSAPP_MODE in config." };
  }

  const isConfigured =
    TWILIO_CONFIG.accountSid !== "YOUR_TWILIO_ACCOUNT_SID" &&
    TWILIO_CONFIG.toNumbers.length > 0 &&
    !TWILIO_CONFIG.toNumbers[0].includes("9XXXXXXXXX");

  if (!isConfigured) {
    return {
      success: false,
      error: "Twilio not configured. Fill in TWILIO_CONFIG at the top of the file.",
    };
  }

  const body =
    `🔔 *OptiFlow OMS Alert*\n\n` +
    `*Type:* ${alert.type}\n` +
    `*Severity:* ${alert.severity?.toUpperCase()}\n` +
    `*Order:* ${alert.orderId || "N/A"}\n` +
    `*Customer:* ${alert.customer || "Unknown"}\n` +
    `*Store:* ${alert.store || "All"}\n` +
    `*Details:* ${alert.message}\n` +
    `*Time:* ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

  const results = await Promise.allSettled(
    TWILIO_CONFIG.toNumbers.map(async (toNumber) => {
      if (WHATSAPP_MODE === "relay") {
        const res = await fetch(RELAY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: toNumber.replace("whatsapp:", ""), body }),
        });
        if (!res.ok) throw new Error(`Relay error: ${res.status}`);
        return res.json();
      } else {
        // Direct mode (not recommended for production)
        const credentials = btoa(`${TWILIO_CONFIG.accountSid}:${TWILIO_CONFIG.authToken}`);
        const form = new URLSearchParams({
          From: TWILIO_CONFIG.fromNumber,
          To: toNumber,
          Body: body,
        });
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_CONFIG.accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form,
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || `Twilio error ${res.status}`);
        return data;
      }
    })
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length === results.length) {
    return { success: false, error: failures[0]?.reason?.message || "All WhatsApp sends failed" };
  }
  return {
    success: true,
    partial: failures.length > 0,
    sent: results.length - failures.length,
    total: results.length,
  };
};

// Send both channels at once, return combined status
const sendAlertNow = async (alert) => {
  const [emailResult, waResult] = await Promise.allSettled([
    sendRealEmail(alert),
    sendRealWhatsApp(alert),
  ]);

  return {
    email: emailResult.status === "fulfilled" ? emailResult.value : { success: false, error: emailResult.reason?.message },
    whatsapp: waResult.status === "fulfilled" ? waResult.value : { success: false, error: waResult.reason?.message },
  };
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const LENS_TYPES = ["Single Vision", "Bifocal", "Progressive", "Office Lens", "Sunglass Tint"];
const LENS_INDEX = ["1.50", "1.56", "1.60", "1.67", "1.74"];
const COATINGS = ["Basic AR", "Premium AR", "Blue Cut", "Photochromic", "Mirror", "None"];
const FRAME_TYPES = ["Full Rim", "Half Rim", "Rimless", "Sports"];
const STORES = ["Hyderabad - Banjara Hills", "Hyderabad - Jubilee Hills", "Mumbai - Andheri", "Bangalore - Koramangala", "Delhi - CP", "Chennai - Anna Nagar"];
const ORDER_SOURCES = ["Walk-in", "WhatsApp", "Website", "Phone", "Partner Store"];

const SLA_HOURS = {
  "Single Vision": 48,
  "Bifocal": 72,
  "Progressive": 96,
  "Office Lens": 72,
  "Sunglass Tint": 24,
};

const ORDER_STATUSES = [
  "Order Placed", "Prescription Verified", "Lens In Stock", "Lens Ordered",
  "In Production", "QC Passed", "QC Failed – Reorder", "Dispatch Ready",
  "Out for Delivery", "Delivered", "Cancelled",
];

const STATUS_COLORS = {
  "Order Placed": "#6366f1", "Prescription Verified": "#8b5cf6",
  "Lens In Stock": "#0ea5e9", "Lens Ordered": "#f59e0b",
  "In Production": "#f97316", "QC Passed": "#10b981",
  "QC Failed – Reorder": "#ef4444", "Dispatch Ready": "#14b8a6",
  "Out for Delivery": "#06b6d4", "Delivered": "#22c55e", "Cancelled": "#6b7280",
};

// ─── MOCK INVENTORY ───────────────────────────────────────────────────────────

const generateInventory = () => {
  const inv = [];
  LENS_TYPES.forEach(lt => {
    LENS_INDEX.forEach(idx => {
      const powers = [
        { sph: "-1.00", cyl: "0.00" }, { sph: "-2.00", cyl: "-0.50" },
        { sph: "+1.50", cyl: "0.00" }, { sph: "-3.00", cyl: "-1.00" },
        { sph: "0.00", cyl: "-0.75" }, { sph: "-4.50", cyl: "-1.25" },
        { sph: "+2.00", cyl: "-0.50" }, { sph: "-5.00", cyl: "0.00" },
        { sph: "-0.50", cyl: "-0.25" }, { sph: "+0.75", cyl: "0.00" },
      ];
      powers.forEach(p => {
        const stock = Math.floor(Math.random() * 10);
        inv.push({ lensType: lt, index: idx, sph: p.sph, cyl: p.cyl, qty: stock, minQty: 2 });
      });
    });
  });
  return inv;
};

// ─── MOCK ORDER GENERATION ────────────────────────────────────────────────────

const generateOrders = (inventory) => {
  const names = ["Rahul Sharma", "Priya Nair", "Kiran Patel", "Sunita Reddy", "Amit Gupta",
    "Deepa Iyer", "Rohit Mehta", "Ananya Singh", "Vijay Kumar", "Meera Joshi", "Arun Balaji", "Sneha Pillai"];
  const sphs = ["-0.50", "-1.00", "-1.50", "-2.00", "-2.50", "-3.00", "+1.00", "+1.50", "+2.00", "-5.00", "-6.00", "-7.00"];
  const cyls = ["0.00", "-0.25", "-0.50", "-0.75", "-1.00", "-1.25", "-1.50", "-2.00"];

  return Array.from({ length: 24 }, (_, i) => {
    const lensType = LENS_TYPES[Math.floor(Math.random() * LENS_TYPES.length)];
    const index = LENS_INDEX[Math.floor(Math.random() * LENS_INDEX.length)];
    const sph = sphs[Math.floor(Math.random() * sphs.length)];
    const cyl = cyls[Math.floor(Math.random() * cyls.length)];
    const coating = COATINGS[Math.floor(Math.random() * COATINGS.length)];
    const store = STORES[Math.floor(Math.random() * STORES.length)];
    const source = ORDER_SOURCES[Math.floor(Math.random() * ORDER_SOURCES.length)];
    const frame = FRAME_TYPES[Math.floor(Math.random() * FRAME_TYPES.length)];
    const slaHours = SLA_HOURS[lensType];
    const hoursAgo = Math.floor(Math.random() * 90);
    const placedAt = new Date(Date.now() - hoursAgo * 3600000);
    const deadline = new Date(placedAt.getTime() + slaHours * 3600000);
    const hoursRemaining = (deadline - Date.now()) / 3600000;
    const breached = hoursRemaining < 0;
    const statusIdx = Math.min(ORDER_STATUSES.length - 1, Math.floor(hoursAgo / 12) + Math.floor(Math.random() * 2));
    const status = ORDER_STATUSES[Math.min(statusIdx, ORDER_STATUSES.length - 2)];
    const inStock = inventory.some(inv =>
      inv.lensType === lensType && inv.index === index && inv.sph === sph && inv.cyl === cyl && inv.qty > 0
    );
    return {
      id: `OMS-${2024001 + i}`, customer: names[i % names.length],
      phone: `+91 ${9000000000 + i}`, store, source, lensType, index, sph, cyl,
      coating, frame, status, slaHours,
      placedAt: placedAt.toISOString(), deadline: deadline.toISOString(),
      hoursRemaining: Math.round(hoursRemaining * 10) / 10, breached, inStock,
      delayReason: breached ? "Supplier delay" : null,
      statusHistory: [{ status: "Order Placed", at: placedAt.toISOString(), by: "System" }],
      aiRisk: breached ? "High" : hoursRemaining < slaHours * 0.25 ? "Medium" : "Low",
      amount: 1200 + Math.floor(Math.random() * 8000),
    };
  });
};

// ─── AI INTEGRATION (Gemini) ──────────────────────────────────────────────────

const GEMINI_API_KEY = ""; // ← paste your key here
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];

const callGemini = async (apiKey, model, systemPrompt, userPrompt) => {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
    }
  );
};

const callClaude = async (prompt, systemPrompt = "") => {
  const system = systemPrompt || "You are an expert operations manager for an eyewear brand. Be concise and actionable. Do not use asterisks or markdown formatting in your responses. Use plain text only.";
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
    return "⚠ Please paste your Gemini API key into the code (const GEMINI_API_KEY = ...).";
  }
  let lastError = "";
  for (const model of GEMINI_MODELS) {
    try {
      const res = await callGemini(GEMINI_API_KEY, model, system, prompt);
      if (res.status === 404) { lastError = `Model ${model} not found`; continue; }
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        return `❌ API key error: ${err?.error?.message || "Key invalid"}`;
      }
      if (res.status === 429) return "⚠ Rate limit reached. Wait 60 seconds.";
      if (!res.ok) { const err = await res.json().catch(() => ({})); lastError = err?.error?.message || `HTTP ${res.status}`; continue; }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
      if (text) return `[${model}]\n` + text;
      lastError = "Empty response";
    } catch (err) { lastError = err.message; }
  }
  return `❌ All models failed. Last error: ${lastError}`;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const fmt = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const hoursToReadable = (h) => {
  if (h < 0) return `${Math.abs(Math.round(h))}h overdue`;
  const days = Math.floor(h / 24);
  const hrs = Math.round(h % 24);
  return days > 0 ? `${days}d ${hrs}h left` : `${hrs}h left`;
};
const getRiskColor = (risk) => risk === "High" ? "#ef4444" : risk === "Medium" ? "#f59e0b" : "#22c55e";

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

const Badge = ({ label, color }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}55`,
    padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
    whiteSpace: "nowrap", letterSpacing: 0.3,
  }}>{label}</span>
);

const SLABar = ({ hoursRemaining, slaHours, breached }) => {
  const pct = Math.max(0, Math.min(100, (hoursRemaining / slaHours) * 100));
  const color = breached ? "#ef4444" : pct < 25 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ width: "100%", marginTop: 4 }}>
      <div style={{ background: "#1e293b", borderRadius: 4, height: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s" }} />
      </div>
      <div style={{ fontSize: 10, color, marginTop: 2 }}>{hoursToReadable(hoursRemaining)}</div>
    </div>
  );
};

const StatCard = ({ label, value, sub, color = "#6366f1" }) => (
  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 140 }}>
    <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{sub}</div>}
  </div>
);

// ─── SEND ALERT BUTTON (reusable) ─────────────────────────────────────────────

const SendAlertButton = ({ alert, label = "Send Real Alert" }) => {
  const [status, setStatus] = useState(null); // null | "sending" | {email, whatsapp}
  const [showResult, setShowResult] = useState(false);

  const handleSend = async () => {
    setStatus("sending");
    setShowResult(true);
    const result = await sendAlertNow(alert);
    setStatus(result);
    setTimeout(() => setShowResult(false), 8000);
  };

  const btnSty = {
    padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600,
    cursor: status === "sending" ? "not-allowed" : "pointer", border: "none",
    background: status === "sending" ? "#334155" : "#7c3aed", color: "#fff",
    display: "flex", alignItems: "center", gap: 6,
  };

  return (
    <div>
      <button style={btnSty} onClick={handleSend} disabled={status === "sending"}>
        {status === "sending" ? "⏳ Sending…" : `📤 ${label}`}
      </button>
      {showResult && status && status !== "sending" && (
        <div style={{
          marginTop: 8, background: "#1e293b", borderRadius: 8,
          padding: "10px 14px", fontSize: 11, display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ color: status.email?.success ? "#4ade80" : "#f87171", display: "flex", alignItems: "center", gap: 6 }}>
            {status.email?.success ? "✅" : "❌"} Email:{" "}
            {status.email?.success ? "Sent to " + EMAILJS_CONFIG.toEmail : status.email?.error}
          </div>
          <div style={{ color: status.whatsapp?.success ? "#4ade80" : "#f87171", display: "flex", alignItems: "center", gap: 6 }}>
            {status.whatsapp?.success ? "✅" : "❌"} WhatsApp:{" "}
            {status.whatsapp?.success
              ? `Sent to ${status.whatsapp.sent}/${status.whatsapp.total} number(s)`
              : status.whatsapp?.error}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ORDER DETAIL MODAL ───────────────────────────────────────────────────────

const OrderModal = ({ order, inventory, onClose, onStatusUpdate }) => {
  const [newStatus, setNewStatus] = useState(order.status);
  const [reason, setReason] = useState("");
  const [aiInsight, setAiInsight] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const stockItem = inventory.find(inv =>
    inv.lensType === order.lensType && inv.index === order.index &&
    inv.sph === order.sph && inv.cyl === order.cyl
  );

  const getAiInsight = async () => {
    setAiLoading(true);
    const prompt = `Order ${order.id} for ${order.customer}:
- Lens: ${order.lensType} ${order.index} index, Sph ${order.sph} Cyl ${order.cyl}
- Coating: ${order.coating}, Frame: ${order.frame}
- Current status: ${order.status}
- Hours remaining on SLA: ${order.hoursRemaining}h (SLA: ${order.slaHours}h)
- In stock: ${order.inStock ? "Yes, qty: " + (stockItem?.qty || 0) : "No – needs sourcing"}
- Risk level: ${order.aiRisk}
- Store: ${order.store}
Provide: 1) Root cause of delay risk, 2) Recommended next action, 3) Estimated resolution time. 3 bullet points max.`;
    try {
      const result = await callClaude(prompt);
      setAiInsight(result);
    } catch { setAiInsight("AI unavailable."); }
    setAiLoading(false);
  };

  const orderAlert = {
    orderId: order.id, customer: order.customer, store: order.store,
    type: order.breached ? "SLA Breached" : "At Risk",
    severity: order.breached ? "critical" : "high",
    message: order.breached
      ? `Order ${order.id} (${order.lensType}) has breached SLA by ${Math.abs(Math.round(order.hoursRemaining))}h`
      : `Order ${order.id} (${order.lensType}) has ${Math.round(order.hoursRemaining)}h remaining on SLA`,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000088", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16,
        padding: 28, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>{order.id} · {order.source}</div>
            <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>{order.customer}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>{order.phone} · {order.store}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
          {[["Lens Type", order.lensType], ["Index", order.index], ["Sphere", order.sph],
            ["Cylinder", order.cyl], ["Coating", order.coating], ["Frame", order.frame],
            ["Amount", `₹${order.amount.toLocaleString("en-IN")}`], ["Placed", fmt(order.placedAt)]
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#1e293b", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{k}</div>
              <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{
          background: order.inStock ? "#052e16" : "#2d1515",
          border: `1px solid ${order.inStock ? "#166534" : "#7f1d1d"}`,
          borderRadius: 10, padding: "12px 16px", marginTop: 16,
        }}>
          <div style={{ color: order.inStock ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: 13 }}>
            {order.inStock ? "✓ Lens in Stock" : "✗ Lens Not in Stock – External Sourcing Required"}
          </div>
          {stockItem && (
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
              Current qty: {stockItem.qty} units · Min required: {stockItem.minQty}
            </div>
          )}
        </div>

        <div style={{ background: "#1e293b", borderRadius: 10, padding: "12px 16px", marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>SLA Deadline: {fmt(order.deadline)}</span>
            <Badge label={order.aiRisk + " Risk"} color={getRiskColor(order.aiRisk)} />
          </div>
          <SLABar hoursRemaining={order.hoursRemaining} slaHours={order.slaHours} breached={order.breached} />
        </div>

        {/* Send Alert for this order */}
        {(order.breached || order.aiRisk === "High" || order.aiRisk === "Medium") && (
          <div style={{ marginTop: 14, background: "#1e293b", borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
              Send Alert for This Order
            </div>
            <SendAlertButton alert={orderAlert} label="Send WhatsApp + Email Alert" />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Update Status</div>
          <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{
            width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
            padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 8,
          }}>
            {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea
            placeholder="Reason for change / delay note (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            style={{
              width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
              padding: "10px 14px", borderRadius: 8, fontSize: 13, resize: "vertical", boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => { onStatusUpdate(order.id, newStatus, reason); onClose(); }}
            style={{
              width: "100%", marginTop: 8, padding: "12px", background: "#6366f1", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >Save Status Update</button>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
          <button
            onClick={getAiInsight} disabled={aiLoading}
            style={{
              padding: "10px 18px", background: "#312e81", color: "#a5b4fc",
              border: "1px solid #4338ca", borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: "pointer", width: "100%",
            }}
          >
            {aiLoading ? "Analyzing with AI…" : "✦ Get AI Recommendation"}
          </button>
          {aiInsight && (
            <div style={{
              marginTop: 12, background: "#1e1b4b", border: "1px solid #3730a3",
              borderRadius: 10, padding: "14px 16px", color: "#c7d2fe", fontSize: 13,
              lineHeight: 1.7, whiteSpace: "pre-wrap",
            }}>{aiInsight}</div>
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
          <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>History</div>
          {order.statusHistory.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{h.status}</div>
                <div style={{ color: "#64748b", fontSize: 11 }}>{fmt(h.at)} · {h.by}</div>
                {h.reason && <div style={{ color: "#f59e0b", fontSize: 11 }}>"{h.reason}"</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── NEW ORDER FORM ───────────────────────────────────────────────────────────

const NewOrderForm = ({ inventory, onAdd, onClose }) => {
  const [form, setForm] = useState({
    customer: "", phone: "", store: STORES[0], source: ORDER_SOURCES[0],
    lensType: LENS_TYPES[0], index: LENS_INDEX[0], sph: "-1.00", cyl: "0.00",
    coating: COATINGS[0], frame: FRAME_TYPES[0], amount: "",
  });
  const [checking, setChecking] = useState(false);
  const [stockResult, setStockResult] = useState(null);

  const checkStock = () => {
    setChecking(true);
    setTimeout(() => {
      const item = inventory.find(inv =>
        inv.lensType === form.lensType && inv.index === form.index &&
        inv.sph === form.sph && inv.cyl === form.cyl
      );
      setStockResult(item ? { inStock: item.qty > 0, qty: item.qty } : { inStock: false, qty: 0 });
      setChecking(false);
    }, 600);
  };

  const submit = () => {
    if (!form.customer || !form.phone) return;
    const slaHours = SLA_HOURS[form.lensType];
    const placedAt = new Date();
    const deadline = new Date(placedAt.getTime() + slaHours * 3600000);
    onAdd({
      id: `OMS-${Date.now()}`, ...form,
      amount: parseInt(form.amount) || 2500,
      status: "Order Placed", slaHours,
      placedAt: placedAt.toISOString(), deadline: deadline.toISOString(),
      hoursRemaining: slaHours, breached: false,
      inStock: stockResult?.inStock || false, delayReason: null,
      statusHistory: [{ status: "Order Placed", at: placedAt.toISOString(), by: "Team" }],
      aiRisk: "Low",
    });
    onClose();
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const sel = (k) => ({ value: form[k], onChange: e => f(k, e.target.value) });
  const inputSty = {
    width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
    padding: "10px 14px", borderRadius: 8, fontSize: 13, boxSizing: "border-box",
  };
  const labelSty = { color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 5 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 700 }}>New Order</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelSty}>Customer Name *</label>
            <input style={inputSty} {...sel("customer")} placeholder="Full name" />
          </div>
          <div><label style={labelSty}>Phone *</label><input style={inputSty} {...sel("phone")} placeholder="+91 XXXXXXXXXX" /></div>
          <div><label style={labelSty}>Amount (₹)</label><input style={inputSty} {...sel("amount")} placeholder="2500" type="number" /></div>
          <div><label style={labelSty}>Store</label><select style={inputSty} {...sel("store")}>{STORES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={labelSty}>Order Source</label><select style={inputSty} {...sel("source")}>{ORDER_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={labelSty}>Lens Type</label><select style={inputSty} {...sel("lensType")} onChange={e => { f("lensType", e.target.value); setStockResult(null); }}>{LENS_TYPES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={labelSty}>Index</label><select style={inputSty} {...sel("index")} onChange={e => { f("index", e.target.value); setStockResult(null); }}>{LENS_INDEX.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={labelSty}>Sphere (SPH)</label><input style={inputSty} {...sel("sph")} onChange={e => { f("sph", e.target.value); setStockResult(null); }} /></div>
          <div><label style={labelSty}>Cylinder (CYL)</label><input style={inputSty} {...sel("cyl")} onChange={e => { f("cyl", e.target.value); setStockResult(null); }} /></div>
          <div><label style={labelSty}>Coating</label><select style={inputSty} {...sel("coating")}>{COATINGS.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label style={labelSty}>Frame Type</label><select style={inputSty} {...sel("frame")}>{FRAME_TYPES.map(s => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button onClick={checkStock} disabled={checking} style={{ flex: 1, padding: "11px", background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
            {checking ? "Checking…" : "Check Stock"}
          </button>
          <button onClick={submit} style={{ flex: 2, padding: "11px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Place Order
          </button>
        </div>
        {stockResult && (
          <div style={{
            marginTop: 12, padding: "12px 16px", borderRadius: 8,
            background: stockResult.inStock ? "#052e16" : "#2d1515",
            border: `1px solid ${stockResult.inStock ? "#166534" : "#7f1d1d"}`,
            color: stockResult.inStock ? "#4ade80" : "#f87171", fontSize: 13, fontWeight: 600,
          }}>
            {stockResult.inStock
              ? `✓ In Stock – ${stockResult.qty} units available.`
              : "✗ Not in Stock – Needs supplier sourcing. Expect 24–48h extra lead time."}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── INVENTORY MODULE ─────────────────────────────────────────────────────────

const InventoryModule = ({ inventory }) => {
  const [filterType, setFilterType] = useState("All");
  const [filterIndex, setFilterIndex] = useState("All");
  const [aiQuery, setAiQuery] = useState("");
  const [aiResp, setAiResp] = useState("");
  const [aiLoad, setAiLoad] = useState(false);

  const filtered = useMemo(() => inventory.filter(item =>
    (filterType === "All" || item.lensType === filterType) &&
    (filterIndex === "All" || item.index === filterIndex)
  ), [inventory, filterType, filterIndex]);

  const lowStock = inventory.filter(i => i.qty <= i.minQty);

  const askAi = async () => {
    if (!aiQuery.trim()) return;
    setAiLoad(true);
    const lowSummary = lowStock.slice(0, 10).map(i =>
      `${i.lensType} ${i.index} Sph${i.sph} Cyl${i.cyl}: ${i.qty} units`
    ).join(", ");
    try {
      const resp = await callClaude(
        `Inventory context - Low stock items: ${lowSummary}. User question: ${aiQuery}`,
        "You are an eyewear inventory manager AI. Answer concisely about reorder decisions, stock optimization, and supply chain for an optical store. Do not use asterisks or markdown formatting. Use plain text only."
      );
      setAiResp(resp);
    } catch { setAiResp("AI unavailable."); }
    setAiLoad(false);
  };

  const inputSty = { background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", padding: "8px 12px", borderRadius: 8, fontSize: 12 };

  // Build a bulk low-stock alert
  const bulkLowStockAlert = {
    type: "Low Stock Alert",
    severity: "medium",
    orderId: null,
    customer: null,
    store: "All Stores",
    message: `${lowStock.length} SKUs at or below minimum stock level. Top items: ${lowStock.slice(0, 3).map(i => `${i.lensType} ${i.index} (${i.qty} left)`).join(", ")}`,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-start" }}>
        <StatCard label="Total SKUs" value={inventory.length} color="#6366f1" />
        <StatCard label="Low Stock Alerts" value={lowStock.length} color="#ef4444" sub="At or below minimum" />
        <StatCard label="Well Stocked" value={inventory.filter(i => i.qty > i.minQty * 2).length} color="#22c55e" />
        <StatCard label="Out of Stock" value={inventory.filter(i => i.qty === 0).length} color="#f59e0b" />
      </div>

      {lowStock.length > 0 && (
        <div style={{ background: "#2d1515", border: "1px solid #7f1d1d", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
            <div style={{ color: "#f87171", fontWeight: 600, fontSize: 13 }}>
              ⚠ {lowStock.length} items at or below minimum stock level
            </div>
            <SendAlertButton alert={bulkLowStockAlert} label="Alert Team" />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {lowStock.slice(0, 8).map((i, idx) => (
              <span key={idx} style={{ background: "#450a0a", color: "#fca5a5", padding: "3px 10px", borderRadius: 6, fontSize: 11 }}>
                {i.lensType} {i.index} · {i.sph}/{i.cyl} ({i.qty} left)
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>✦ Ask AI about inventory</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputSty, flex: 1 }}
            placeholder="e.g. Which lens types should I reorder this week?"
            value={aiQuery}
            onChange={e => setAiQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && askAi()}
          />
          <button onClick={askAi} disabled={aiLoad} style={{ padding: "8px 16px", background: "#312e81", color: "#a5b4fc", border: "1px solid #4338ca", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
            {aiLoad ? "…" : "Ask"}
          </button>
        </div>
        {aiResp && (
          <div style={{ marginTop: 10, background: "#1e1b4b", border: "1px solid #3730a3", borderRadius: 8, padding: "12px 14px", color: "#c7d2fe", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {aiResp}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select style={inputSty} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="All">All Lens Types</option>
          {LENS_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select style={inputSty} value={filterIndex} onChange={e => setFilterIndex(e.target.value)}>
          <option value="All">All Index</option>
          {LENS_INDEX.map(i => <option key={i}>{i}</option>)}
        </select>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#1e293b" }}>
              {["Lens Type", "Index", "SPH", "CYL", "Qty", "Min Qty", "Status"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((item, i) => {
              const isLow = item.qty <= item.minQty;
              const isOut = item.qty === 0;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #1e293b", background: isOut ? "#2d151520" : isLow ? "#2d1a0020" : "transparent" }}>
                  <td style={{ padding: "9px 12px", color: "#e2e8f0" }}>{item.lensType}</td>
                  <td style={{ padding: "9px 12px", color: "#94a3b8" }}>{item.index}</td>
                  <td style={{ padding: "9px 12px", color: "#94a3b8" }}>{item.sph}</td>
                  <td style={{ padding: "9px 12px", color: "#94a3b8" }}>{item.cyl}</td>
                  <td style={{ padding: "9px 12px", color: isOut ? "#ef4444" : isLow ? "#f59e0b" : "#22c55e", fontWeight: 700 }}>{item.qty}</td>
                  <td style={{ padding: "9px 12px", color: "#64748b" }}>{item.minQty}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <Badge label={isOut ? "Out of Stock" : isLow ? "Low Stock" : "OK"} color={isOut ? "#ef4444" : isLow ? "#f59e0b" : "#22c55e"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── ALERTS MODULE ────────────────────────────────────────────────────────────

const AlertsModule = ({ orders }) => {
  const [alerts, setAlerts] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  useEffect(() => {
    const generated = [];
    orders.forEach(o => {
      if (o.breached) {
        generated.push({
          id: o.id + "-breach", orderId: o.id, customer: o.customer, type: "SLA Breached",
          severity: "critical", store: o.store, time: new Date().toISOString(),
          message: `${o.id} (${o.lensType}) has breached SLA by ${Math.abs(Math.round(o.hoursRemaining))}h`,
        });
      } else if (o.hoursRemaining < o.slaHours * 0.2) {
        generated.push({
          id: o.id + "-risk", orderId: o.id, customer: o.customer, type: "At Risk",
          severity: "high", store: o.store, time: new Date().toISOString(),
          message: `${o.id} (${o.lensType}) has only ${Math.round(o.hoursRemaining)}h remaining`,
        });
      } else if (o.status === "QC Failed – Reorder") {
        generated.push({
          id: o.id + "-qc", orderId: o.id, customer: o.customer, type: "QC Failure",
          severity: "high", store: o.store, time: new Date().toISOString(),
          message: `${o.id} failed QC and needs reorder – SLA risk`,
        });
      } else if (!o.inStock && o.status === "Order Placed") {
        generated.push({
          id: o.id + "-stock", orderId: o.id, customer: o.customer, type: "Stock Out",
          severity: "medium", store: o.store, time: new Date().toISOString(),
          message: `${o.id} lens not in stock – needs supplier order`,
        });
      }
    });
    setAlerts(generated);
  }, [orders]);

  const runAiAnalysis = async () => {
    setAnalyzing(true);
    const summary = alerts.slice(0, 8).map(a => `${a.type}: ${a.message}`).join("\n");
    const breachedOrders = orders.filter(o => o.breached).length;
    const atRisk = orders.filter(o => !o.breached && o.hoursRemaining < o.slaHours * 0.25).length;
    try {
      const resp = await callClaude(
        `Today's operational snapshot:\n- ${breachedOrders} orders breached SLA\n- ${atRisk} at risk in next 12h\n- Alerts:\n${summary}\n\nProvide a prioritized 3-point action plan. Be specific and actionable.`,
        "You are a senior operations manager at an eyewear brand. Give practical, direct advice. No asterisks or markdown. Plain text only."
      );
      setAiAnalysis(resp);
    } catch { setAiAnalysis("AI unavailable."); }
    setAnalyzing(false);
  };

  // Send all critical + high alerts at once
  const sendAllCritical = async () => {
    setBulkSending(true);
    setBulkResult(null);
    const criticalAlerts = alerts.filter(a => !dismissed.has(a.id) && (a.severity === "critical" || a.severity === "high"));
    if (criticalAlerts.length === 0) {
      setBulkResult({ info: "No critical/high alerts to send." });
      setBulkSending(false);
      return;
    }
    // Combine into one summary alert
    const summaryAlert = {
      type: "Bulk Operations Alert",
      severity: "critical",
      orderId: criticalAlerts.map(a => a.orderId).filter(Boolean).slice(0, 5).join(", "),
      customer: `${criticalAlerts.length} orders affected`,
      store: "Multiple Stores",
      message:
        `${criticalAlerts.length} critical/high alerts require immediate action:\n` +
        criticalAlerts.slice(0, 5).map(a => `• [${a.type}] ${a.message}`).join("\n"),
    };
    const result = await sendAlertNow(summaryAlert);
    setBulkResult(result);
    setBulkSending(false);
  };

  const sevColor = { critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#22c55e" };
  const sevBg = { critical: "#2d1515", high: "#2d1a00", medium: "#2d2000", low: "#052e16" };
  const sevBorder = { critical: "#7f1d1d", high: "#7c2d12", medium: "#713f12", low: "#166534" };
  const visible = alerts.filter(a => !dismissed.has(a.id));

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Critical (Breached)" value={alerts.filter(a => a.severity === "critical").length} color="#ef4444" />
        <StatCard label="High Risk" value={alerts.filter(a => a.severity === "high").length} color="#f97316" />
        <StatCard label="Medium" value={alerts.filter(a => a.severity === "medium").length} color="#f59e0b" />
        <StatCard label="Total Active" value={visible.length} color="#6366f1" />
      </div>

      <button onClick={runAiAnalysis} disabled={analyzing} style={{
        padding: "12px 24px", background: "#312e81", color: "#a5b4fc",
        border: "1px solid #4338ca", borderRadius: 10, fontSize: 13, fontWeight: 600,
        cursor: "pointer", marginBottom: 12, display: "block", width: "100%",
      }}>
        {analyzing ? "✦ Analyzing all alerts with AI…" : "✦ Run AI Operations Analysis"}
      </button>

      {aiAnalysis && (
        <div style={{
          background: "#1e1b4b", border: "1px solid #3730a3", borderRadius: 12,
          padding: "18px 20px", color: "#c7d2fe", fontSize: 13, lineHeight: 1.8,
          marginBottom: 16, whiteSpace: "pre-wrap",
        }}>
          <div style={{ color: "#818cf8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>✦ AI Operations Brief</div>
          {aiAnalysis}
        </div>
      )}

      {/* Real Alert Channels */}
      <div style={{
        background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
        padding: "16px 20px", marginBottom: 20,
      }}>
        <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>📤 Real Alert Channels</div>
        <div style={{ color: "#475569", fontSize: 11, marginBottom: 14 }}>
          Configure EMAILJS_CONFIG and TWILIO_CONFIG at the top of the file to activate.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <button
              onClick={sendAllCritical}
              disabled={bulkSending}
              style={{
                padding: "10px 20px", background: bulkSending ? "#334155" : "#7c3aed",
                color: "#fff", border: "none", borderRadius: 8, fontSize: 13,
                fontWeight: 600, cursor: bulkSending ? "not-allowed" : "pointer",
              }}
            >
              {bulkSending ? "⏳ Sending all critical alerts…" : "📤 Send All Critical Alerts (WhatsApp + Email)"}
            </button>
            {bulkResult && (
              <div style={{ marginTop: 8, background: "#1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 11 }}>
                {bulkResult.info
                  ? <div style={{ color: "#94a3b8" }}>{bulkResult.info}</div>
                  : <>
                    <div style={{ color: bulkResult.email?.success ? "#4ade80" : "#f87171" }}>
                      {bulkResult.email?.success ? "✅" : "❌"} Email: {bulkResult.email?.success ? "Sent" : bulkResult.email?.error}
                    </div>
                    <div style={{ color: bulkResult.whatsapp?.success ? "#4ade80" : "#f87171" }}>
                      {bulkResult.whatsapp?.success ? "✅" : "❌"} WhatsApp: {bulkResult.whatsapp?.success
                        ? `Sent to ${bulkResult.whatsapp.sent}/${bulkResult.whatsapp.total} number(s)`
                        : bulkResult.whatsapp?.error}
                    </div>
                  </>
                }
              </div>
            )}
          </div>
          <div style={{ color: "#334155", fontSize: 11, alignSelf: "center" }}>
            Individual alert buttons also appear on each order card below →
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14 }}>No active alerts</div>
          </div>
        )}
        {visible.map(alert => (
          <div key={alert.id} style={{
            background: sevBg[alert.severity], border: `1px solid ${sevBorder[alert.severity]}`,
            borderRadius: 10, padding: "14px 18px",
            display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <Badge label={alert.type} color={sevColor[alert.severity]} />
                <span style={{ color: "#64748b", fontSize: 11 }}>{alert.store}</span>
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 13 }}>{alert.message}</div>
              <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>
                {alert.customer} · {alert.orderId}
              </div>
              <div style={{ marginTop: 10 }}>
                <SendAlertButton alert={alert} label="Send Alert" />
              </div>
            </div>
            <button onClick={() => setDismissed(p => new Set([...p, alert.id]))} style={{
              background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, flexShrink: 0,
            }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── DASHBOARD MODULE ─────────────────────────────────────────────────────────

const DashboardModule = ({ orders, setOrders, inventory, onNewOrder }) => {
  const [selected, setSelected] = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterLens, setFilterLens] = useState("All");
  const [filterStore, setFilterStore] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("hoursRemaining");

  const filtered = useMemo(() => {
    let arr = [...orders];
    if (filterStatus !== "All") arr = arr.filter(o => o.status === filterStatus);
    if (filterLens !== "All") arr = arr.filter(o => o.lensType === filterLens);
    if (filterStore !== "All") arr = arr.filter(o => o.store === filterStore);
    if (search) arr = arr.filter(o =>
      o.customer.toLowerCase().includes(search.toLowerCase()) ||
      o.id.toLowerCase().includes(search.toLowerCase())
    );
    arr.sort((a, b) => {
      if (sort === "hoursRemaining") return a.hoursRemaining - b.hoursRemaining;
      if (sort === "placedAt") return new Date(b.placedAt) - new Date(a.placedAt);
      if (sort === "customer") return a.customer.localeCompare(b.customer);
      return 0;
    });
    return arr;
  }, [orders, filterStatus, filterLens, filterStore, search, sort]);

  const handleStatusUpdate = (orderId, newStatus, reason) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return {
        ...o, status: newStatus, delayReason: reason || o.delayReason,
        statusHistory: [...o.statusHistory, { status: newStatus, at: new Date().toISOString(), by: "Team", reason: reason || undefined }],
      };
    }));
  };

  const selOrder = orders.find(o => o.id === selected);
  const inputSty = { background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", padding: "8px 12px", borderRadius: 8, fontSize: 12 };
  const breached = orders.filter(o => o.breached).length;
  const atRisk = orders.filter(o => !o.breached && o.hoursRemaining < o.slaHours * 0.25).length;
  const delivered = orders.filter(o => o.status === "Delivered").length;
  const inProd = orders.filter(o => o.status === "In Production").length;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Total Orders" value={orders.length} color="#6366f1" />
        <StatCard label="In Production" value={inProd} color="#f97316" />
        <StatCard label="SLA Breached" value={breached} color="#ef4444" sub="Needs immediate action" />
        <StatCard label="At Risk" value={atRisk} color="#f59e0b" sub="<25% SLA remaining" />
        <StatCard label="Delivered" value={delivered} color="#22c55e" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          style={{ ...inputSty, flex: 1, minWidth: 160 }}
          placeholder="Search order ID or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={inputSty} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="All">All Statuses</option>
          {ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select style={inputSty} value={filterLens} onChange={e => setFilterLens(e.target.value)}>
          <option value="All">All Lens Types</option>
          {LENS_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select style={inputSty} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
          <option value="All">All Stores</option>
          {STORES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select style={inputSty} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="hoursRemaining">Sort: SLA Urgency</option>
          <option value="placedAt">Sort: Newest</option>
          <option value="customer">Sort: Name</option>
        </select>
        <button onClick={onNewOrder} style={{ padding: "8px 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          + New Order
        </button>
      </div>

      <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>{filtered.length} orders shown</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(order => (
          <div key={order.id}
            onClick={() => setSelected(order.id)}
            style={{
              background: "#0f172a", border: `1px solid ${order.breached ? "#7f1d1d" : "#1e293b"}`,
              borderRadius: 12, padding: "14px 18px", cursor: "pointer",
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start",
            }}
          >
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ color: "#64748b", fontSize: 11, fontFamily: "monospace" }}>{order.id}</span>
                <Badge label={order.status} color={STATUS_COLORS[order.status] || "#6366f1"} />
                <Badge label={order.aiRisk + " Risk"} color={getRiskColor(order.aiRisk)} />
                {!order.inStock && <Badge label="Stock Out" color="#f59e0b" />}
              </div>
              <div style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 600 }}>{order.customer}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                {order.lensType} · {order.index} idx · Sph {order.sph} / Cyl {order.cyl} · {order.coating}
              </div>
              <div style={{ color: "#475569", fontSize: 11, marginTop: 3 }}>
                {order.store} · via {order.source} · ₹{order.amount.toLocaleString("en-IN")} · {fmt(order.placedAt)}
              </div>
            </div>
            <div style={{ minWidth: 120 }}>
              <div style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>SLA: {order.slaHours}h</div>
              <SLABar hoursRemaining={order.hoursRemaining} slaHours={order.slaHours} breached={order.breached} />
              {order.delayReason && <div style={{ color: "#f59e0b", fontSize: 10, marginTop: 4 }}>⚠ {order.delayReason}</div>}
            </div>
          </div>
        ))}
      </div>

      {selOrder && (
        <OrderModal
          order={selOrder}
          inventory={inventory}
          onClose={() => setSelected(null)}
          onStatusUpdate={handleStatusUpdate}
        />
      )}
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [inventory] = useState(generateInventory);
  const [orders, setOrders] = useState(() => generateOrders(generateInventory()));
  const [showNewOrder, setShowNewOrder] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => {
        if (o.status === "Delivered" || o.status === "Cancelled") return o;
        const hrs = (new Date(o.deadline) - Date.now()) / 3600000;
        return {
          ...o,
          hoursRemaining: Math.round(hrs * 10) / 10,
          breached: hrs < 0,
          aiRisk: hrs < 0 ? "High" : hrs < o.slaHours * 0.2 ? "High" : hrs < o.slaHours * 0.4 ? "Medium" : "Low",
        };
      }));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const alerts = orders.filter(o => o.breached || o.aiRisk === "High" || o.status === "QC Failed – Reorder").length;

  const TAB_LABELS = [
    { id: "dashboard", label: "Orders", icon: "📋" },
    { id: "inventory", label: "Inventory", icon: "📦" },
    { id: "alerts", label: `Alerts${alerts > 0 ? ` (${alerts})` : ""}`, icon: "🔔" },
  ];

  return (
    <div style={{ background: "#020817", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{
        background: "#0a0f1e", borderBottom: "1px solid #1e293b",
        padding: "0 24px", display: "flex", alignItems: "center", gap: 20,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ padding: "14px 0", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👓</div>
          <div>
            <div style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 700, lineHeight: 1 }}>OptiFlow OMS</div>
            <div style={{ color: "#475569", fontSize: 10 }}>AI-Powered Order Management</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {TAB_LABELS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 16px", background: tab === t.id ? "#1e293b" : "none",
              border: "none", borderRadius: 8, color: tab === t.id ? "#e2e8f0" : "#64748b",
              fontSize: 13, cursor: "pointer", fontWeight: tab === t.id ? 600 : 400,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700 }}>
            {tab === "dashboard" ? "Order Dashboard" : tab === "inventory" ? "Lens Inventory" : "Alerts & Breach Predictions"}
          </div>
          <div style={{ color: "#475569", fontSize: 13, marginTop: 2 }}>
            {tab === "dashboard" && "Manage all orders through the full fulfilment lifecycle"}
            {tab === "inventory" && "Real-time lens stock levels with AI reorder recommendations"}
            {tab === "alerts" && "AI-powered SLA breach predictions and operational alerts"}
          </div>
        </div>

        {tab === "dashboard" && <DashboardModule orders={orders} setOrders={setOrders} inventory={inventory} onNewOrder={() => setShowNewOrder(true)} />}
        {tab === "inventory" && <InventoryModule inventory={inventory} />}
        {tab === "alerts" && <AlertsModule orders={orders} />}
      </div>

      {showNewOrder && (
        <NewOrderForm
          inventory={inventory}
          onAdd={order => setOrders(p => [order, ...p])}
          onClose={() => setShowNewOrder(false)}
        />
      )}
    </div>
  );
}
