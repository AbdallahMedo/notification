const express = require("express");
const admin = require("firebase-admin");
const cron = require("node-cron");

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

// ============================================================
// 📅 EID DATE CONFIG — عيد الفطر 2026
// ✅ غيّر السطر ده بس لو اتأجل العيد يوم
// ============================================================
const EID_FIRST_DAY = "2026-03-20"; // الجمعة 20 مارس — أول يوم عيد الفطر 2026

function getEidDates() {
  const day1 = new Date(EID_FIRST_DAY);
  const day0 = new Date(day1); day0.setDate(day1.getDate() - 1); // ليلة العيد (الخميس 19 مارس)
  const day2 = new Date(day1); day2.setDate(day1.getDate() + 1); // ثاني يوم (السبت 21 مارس)
  const day3 = new Date(day1); day3.setDate(day1.getDate() + 2); // ثالث يوم (الأحد 22 مارس)
  const day4 = new Date(day1); day4.setDate(day1.getDate() + 3); // آخر إجازة (الإثنين 23 مارس)
  return { day0, day1, day2, day3, day4 };
}

// تحويل Date + ساعة → cron expression
// ⚠️ node-cron بيشتغل بالوقت المحلي للسيرفر
// لو رفعته على Monster/Render — تأكد إن timezone السيرفر هو Africa/Cairo
// أو حوّل الساعات لـ UTC (مصر = UTC+3 في رمضان = UTC+2 تاني وقت)
function dateToCron(date, hour, minute = 0) {
  return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`;
}

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
  const { token, title, body } = req.body;
  try {
    const result = await sendNotification(token, title, body);
    res.json({ success: true, messageId: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إرسال لكل الموظفين — استخدم {name} و {company} في الـ body
app.post("/send-all", async (req, res) => {
  const { title, body } = req.body;
  try {
    const users = await getAllUsers();
    if (users.length === 0)
      return res.status(400).json({ error: "No registered users" });
    const results = await sendToAll(title, body, users);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إرسال لموظف بالاسم
app.post("/send-user", async (req, res) => {
  const { name, title, body } = req.body;
  try {
    const doc = await db.collection(USERS_COLLECTION).doc(name).get();
    if (!doc.exists)
      return res.status(404).json({ error: `User "${name}" not found` });
    const user = doc.data();
    const result = await sendNotification(
      user.token,
      title.replace("{name}", user.name).replace("{company}", COMPANY),
      body.replace("{name}", user.name).replace("{company}", COMPANY)
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
async function sendNotification(token, title, body) {
  return await admin.messaging().send({
    token,
    notification: { title, body },
    android: {
      priority: "high",
      notification: { sound: "default", channelId: "eid_channel", icon: "ic_launcher" },
    },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
  });
}

async function sendToAll(titleTemplate, bodyTemplate, users = null) {
  // لو مفيش users اتبعتوا، اجيبهم من Firestore
  if (!users) users = await getAllUsers();
  const results = [];
  for (const user of users) {
    const title = titleTemplate.replace(/\{name\}/g, user.name).replace(/\{company\}/g, COMPANY);
    const body  = bodyTemplate.replace(/\{name\}/g, user.name).replace(/\{company\}/g, COMPANY);
    try {
      const msgId = await sendNotification(user.token, title, body);
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
// ⏰ SCHEDULED EID NOTIFICATIONS — عيد الفطر 2026
// ⚠️ مهم: تأكد إن السيرفر timezone هو Africa/Cairo
//    على Monster/Railway: ضيف env variable TZ=Africa/Cairo
// ============================================================
function scheduleEidNotifications() {
  const { day0, day1, day2, day3, day4 } = getEidDates();

  console.log("\n📅 جدول نوتفكيشنز عيد الفطر 2026:");
  console.log(`   🌙 ليلة العيد     : ${day0.toDateString()} — الخميس 19 مارس — 9م`);
  console.log(`   🌅 أول يوم (جمعة) : ${day1.toDateString()} — 8ص و12ظ`);
  console.log(`   🌸 ثاني يوم (سبت) : ${day2.toDateString()} — 9ص و4ع`);
  console.log(`   ☀️  ثالث يوم (أحد) : ${day3.toDateString()} — 9ص`);
  console.log(`   🏢 الإثنين (آخر إجازة): ${day4.toDateString()} — 9ص و3ع\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🌙 ليلة العيد — الخميس 19 مارس — 9م
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule(dateToCron(day0, 21), async () => {
    console.log("⏰ [ليلة العيد] إرسال تهنئة...");
    await sendToAll(
      `🌙 {company} تهنئكم بعيد الفطر المبارك`,
      `يا {name}.. كل عام وأنتم بخير 🌙\nعيد مبارك سعيد من كل فريق {company}!\nتقبل الله منا ومنكم صالح الأعمال ✨`
    );
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🌅 أول يوم — الجمعة 20 مارس — 8ص — دعاء
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule(dateToCron(day1, 8), async () => {
    console.log("⏰ [أول يوم صبح] إرسال دعاء...");
    await sendToAll(
      `🤲 دعاء العيد | {company}`,
      `يا {name}.. اللهم تقبل منا الصيام والقيام وصالح الأعمال 🤲\nوأعاده علينا وعليكم بالخير والبركات 🕌`
    );
  });

  // 🎉 أول يوم — 12ظ — تهنئة شخصية
  cron.schedule(dateToCron(day1, 12), async () => {
    console.log("⏰ [أول يوم ظهر] تهنئة شخصية...");
    await sendToAll(
      `🎉 عيد مبارك يا {name}!`,
      `كل سنة وانت طيب يا {name}! 🎊\nعساكم من عواده ❤️\n— فريق {company}`
    );
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🌸 ثاني يوم — السبت 21 مارس — 9ص
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule(dateToCron(day2, 9), async () => {
    console.log("⏰ [ثاني يوم صبح]...");
    await sendToAll(
      `🌸 صباح الخير يا {name}!`,
      `صباح الفرحة والبركة من {company} 🌸\nاللهم اجعل أيامنا كلها خير وسعادة 💫`
    );
  });

  // 😄 ثاني يوم — 4ع — رسالة فانية
  cron.schedule(dateToCron(day2, 16), async () => {
    console.log("⏰ [ثاني يوم عصر] الرسالة الفانية...");
    await sendToAll(
      `😄 تذكير مهم من {company}!`,
      `يا {name}.. الكحك والبسكويت مش هيفضل للأبد 😂\nاستمتع بالعيد قبل ما يخلص! 🍪🎉`
    );
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ☀️ ثالث يوم — الأحد 22 مارس — 9ص
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule(dateToCron(day3, 9), async () => {
    console.log("⏰ [ثالث يوم صبح]...");
    await sendToAll(
      `☀️ يا {name} إزيك في العيد؟`,
      `كل سنة وانت بخير يا {name} 😊\nنتمنالك إجازة حلوة مع أهلك وأحبابك ❤️\n— {company}`
    );
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🏢 الإثنين 23 مارس — آخر إجازة — 9ص — تذكير الشغل
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule(dateToCron(day4, 9), async () => {
    console.log("⏰ [الإثنين صبح] تذكير رجوع الشغل...");
    await sendToAll(
      `🏢 {company} | تذكير الدوام`,
      `يا {name}.. عيد مبارك! 🎉\nنذكركم إن أول يوم شغل هو يوم الثلاثاء إن شاء الله ✅\nاستمتع بباقي الإجازة 😊`
    );
  });

  // 📋 الإثنين — 3ع — تأكيد تاني
  cron.schedule(dateToCron(day4, 15), async () => {
    console.log("⏰ [الإثنين عصر] تأكيد موعد الشغل...");
    await sendToAll(
      `📋 {company} | تأكيد الدوام`,
      `يا {name}.. تذكير ودي 💼\nالدوام بكره الثلاثاء الصبح ✅\nنتمنى لك راحة تامة في باقي العيد ❤️`
    );
  });

  console.log("✅ كل نوتفكيشنز عيد الفطر 2026 اتجدولت بنجاح!\n");
}

// ============================================================
// 🚀 START SERVER
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

  scheduleEidNotifications();
});