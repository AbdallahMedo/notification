const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
require('dotenv').config();

// ============================================================
// 🏢 اسم الشركة
// ============================================================
const COMPANY = "كيم تك";

// ============================================================
// 🔥 Firebase Admin
// ============================================================
// const serviceAccount = require("./serviceAccountKey.json");

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: "googleapis.com"
};
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const USERS_COLLECTION = "fcm_users"; // اسم الـ collection في Firestore

// ============================================================
// 👥 Users — محفوظين في Firestore بدل الميموري
// ============================================================

// جيب كل المستخدمين من Firestore
async function getAllUsers() {
  const snapshot = await db.collection(USERS_COLLECTION).get();
  return snapshot.docs.map((doc) => doc.data()); // كل doc فيه { name, token }
}

// سجّل أو حدّث مستخدم
async function upsertUser(name, token) {
  await db.collection(USERS_COLLECTION).doc(name).set({ name, token }, { merge: true });
}

const API_KEY = process.env.API_KEY || null;
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});

// ============================================================
// 📌 ENDPOINTS
// ============================================================

// تسجيل موظف (بيحفظ في Firestore)
app.post("/register", async (req, res) => {
  const { name, token } = req.body;
  if (!name || !token)
    return res.status(400).json({ error: "name and token are required" });

  try {
    await upsertUser(name, token);
    console.log(`✅ Saved to Firestore: ${name}`);
    res.json({ success: true, message: `تم تسجيل ${name} في ${COMPANY} 🎉` });
  } catch (err) {
    console.error("❌ Firestore error:", err.message);
    res.status(500).json({ error: "فشل الحفظ في Firestore" });
  }
});

// عرض المسجلين
app.get("/users", async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ count: users.length, users: users.map((u) => u.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تيست بتوكن مباشر
app.post("/send-test", async (req, res) => {
  const { token, title, body, data, androidChannelId, imageUrl } = req.body;
  if (!token || !title || !body)
    return res.status(400).json({ error: "token, title and body are required" });
  try {
    const result = await sendNotification(token, title, body, { data, androidChannelId, imageUrl });
    res.json({ success: true, messageId: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إرسال لكل الموظفين — استخدم {name} و {company} في الـ body
app.post("/send-all", async (req, res) => {
  const { title, body, data, androidChannelId, imageUrl } = req.body;
  if (!title || !body)
    return res.status(400).json({ error: "title and body are required" });
  try {
    const users = await getAllUsers();
    if (users.length === 0)
      return res.status(400).json({ error: "No registered users" });
    const results = await sendToAll(title, body, users, { data, androidChannelId, imageUrl });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إرسال لموظف بالاسم
app.post("/send-user", async (req, res) => {
  const { name, title, body, data, androidChannelId, imageUrl } = req.body;
  if (!name || !title || !body)
    return res.status(400).json({ error: "name, title and body are required" });
  try {
    const doc = await db.collection(USERS_COLLECTION).doc(name).get();
    if (!doc.exists)
      return res.status(404).json({ error: `User "${name}" not found` });
    const user = doc.data();
    const result = await sendNotification(
      user.token,
      title.replace("{name}", user.name).replace("{company}", COMPANY),
      body.replace("{name}", user.name).replace("{company}", COMPANY),
      { data, androidChannelId, imageUrl }
    );
    res.json({ success: true, messageId: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// حذف مستخدم
app.delete("/users/:name", async (req, res) => {
  try {
    await db.collection(USERS_COLLECTION).doc(req.params.name).delete();
    res.json({ success: true, message: `تم حذف ${req.params.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 🔧 HELPERS
// ============================================================
function normalizeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[String(k)] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

async function sendNotification(token, title, body, options = {}) {
  const normalizedData = normalizeData(options.data);
  const message = {
    token,
    notification: { title, body, ...(options.imageUrl ? { imageUrl: options.imageUrl } : {}) },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: options.androidChannelId || "eid_channel",
        icon: "ic_launcher"
      },
    },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
    ...(normalizedData ? { data: normalizedData } : {}),
  };
  return await admin.messaging().send(message);
}

async function sendToAll(titleTemplate, bodyTemplate, users = null, options = {}) {
  // لو مفيش users اتبعتوا، اجيبهم من Firestore
  if (!users) users = await getAllUsers();
  const results = [];
  for (const user of users) {
    const title = titleTemplate.replace(/\{name\}/g, user.name).replace(/\{company\}/g, COMPANY);
    const body  = bodyTemplate.replace(/\{name\}/g, user.name).replace(/\{company\}/g, COMPANY);
    try {
      const msgId = await sendNotification(user.token, title, body, options);
      results.push({ name: user.name, status: "✅ sent", messageId: msgId });
      console.log(`✅ Sent to ${user.name}`);
    } catch (err) {
      results.push({ name: user.name, status: "❌ failed", error: err.message });
      console.log(`❌ Failed for ${user.name}: ${err.message}`);
      // لو التوكن expired، احذفه من Firestore تلقائياً
      if (err.code === "messaging/registration-token-not-registered") {
        await db.collection(USERS_COLLECTION).doc(user.name).delete();
        console.log(`🗑️ Removed expired token for ${user.name}`);
      }
    }
  }
  return results;
}

// ============================================================
//  START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 ${COMPANY} — Notification Server`);
  console.log(`📡 Running on port ${PORT}\n`);
  console.log(`📋 Endpoints:`);
  console.log(`   POST   /register      — تسجيل موظف (محفوظ في Firestore)`);
  console.log(`   GET    /users         — عرض المسجلين`);
  console.log(`   DELETE /users/:name   — حذف مستخدم`);
  console.log(`   POST   /send-test     — تيست بتوكن مباشر`);
  console.log(`   POST   /send-all      — إرسال لكل الموظفين`);
  console.log(`   POST   /send-user     — إرسال لموظف معين`);
});