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
const USERS_COLLECTION = "fcm_users";
const SENT_LOG_COLLECTION = "sent_notifications_log"; // ✅ سجل الإرساليات المتبعتة

// ============================================================
// 👥 Users — Firestore
// ============================================================
async function getAllUsers() {
  const snapshot = await db.collection(USERS_COLLECTION).get();
  return snapshot.docs.map((doc) => doc.data());
}

async function upsertUser(name, token) {
  await db.collection(USERS_COLLECTION).doc(name).set({ name, token }, { merge: true });
}

// ============================================================
// 📅 EID DATE CONFIG — عيد الفطر 2026
// ============================================================
const EID_FIRST_DAY = "2026-03-20";

function getEidDates() {
  const day1 = new Date(EID_FIRST_DAY);
  const day0 = new Date(day1); day0.setDate(day1.getDate() - 1);
  const day2 = new Date(day1); day2.setDate(day1.getDate() + 1);
  const day3 = new Date(day1); day3.setDate(day1.getDate() + 2);
  const day4 = new Date(day1); day4.setDate(day1.getDate() + 3);
  return { day0, day1, day2, day3, day4 };
}

function dateToCron(date, hour, minute = 0) {
  return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`;
}

// ============================================================
// 🗓️ جدول كل الـ notifications مع وقتها بالـ Cairo time
// ⚠️ مهم: ضيف TZ=Africa/Cairo في env variables على Render
// ============================================================
function getNotificationSchedule() {
  const { day0, day1, day2, day3, day4 } = getEidDates();

  // دالة مساعدة تعمل Date object بالوقت المحدد (بالـ local time على السيرفر)
  function makeScheduledTime(date, hour, minute = 0) {
    const d = new Date(date);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  return [
    {
      id: "eid_eve_9pm",
      scheduledAt: makeScheduledTime(day0, 21, 0),
      title: `🌙 {company} تهنئكم بعيد الفطر المبارك`,
      body: `يا {name}.. كل عام وأنتم بخير 🌙\nعيد مبارك سعيد من كل فريق {company}!\nتقبل الله منا ومنكم صالح الأعمال ✨`,
      label: "🌙 ليلة العيد — 9م"
    },
    {
      id: "eid_day1_8am",
      scheduledAt: makeScheduledTime(day1, 8, 0),
      title: `🤲 دعاء العيد | {company}`,
      body: `يا {name}.. اللهم تقبل منا الصيام والقيام وصالح الأعمال 🤲\nوأعاده علينا وعليكم بالخير والبركات 🕌`,
      label: "🌅 أول يوم — 8ص"
    },
    {
      id: "eid_day1_12pm",
      scheduledAt: makeScheduledTime(day1, 12, 0),
      title: `🎉 عيد مبارك يا {name}!`,
      body: `كل سنة وانت طيب يا {name}! 🎊\nعساكم من عواده ❤️\n— فريق {company}`,
      label: "🎉 أول يوم — 12ظ"
    },
    {
      id: "eid_day2_9am",
      scheduledAt: makeScheduledTime(day2, 9, 0),
      title: `🌸 صباح الخير يا {name}!`,
      body: `صباح الفرحة والبركة من {company} 🌸\nاللهم اجعل أيامنا كلها خير وسعادة 💫`,
      label: "🌸 ثاني يوم — 9ص"
    },
    {
      id: "eid_day2_4pm",
      scheduledAt: makeScheduledTime(day2, 16, 0),
      title: `😄 تذكير مهم من {company}!`,
      body: `يا {name}.. الكحك والبسكويت مش هيفضل للأبد 😂\nاستمتع بالعيد قبل ما يخلص! 🍪🎉`,
      label: "😄 ثاني يوم — 4ع"
    },
    {
      id: "eid_day3_9am",
      scheduledAt: makeScheduledTime(day3, 9, 0),
      title: `☀️ يا {name} إزيك في العيد؟`,
      body: `كل سنة وانت بخير يا {name} 😊\nنتمنالك إجازة حلوة مع أهلك وأحبابك ❤️\n— {company}`,
      label: "☀️ ثالث يوم — 9ص"
    },
    {
      id: "eid_day4_9am",
      scheduledAt: makeScheduledTime(day4, 9, 0),
      title: `🏢 {company} | تذكير الدوام`,
      body: `يا {name}.. عيد مبارك! 🎉\nنذكركم إن أول يوم شغل هو يوم الثلاثاء إن شاء الله ✅\nاستمتع بباقي الإجازة 😊`,
      label: "🏢 الإثنين — 9ص"
    },
    {
      id: "eid_day4_3pm",
      scheduledAt: makeScheduledTime(day4, 15, 0),
      title: `📋 {company} | تأكيد الدوام`,
      body: `يا {name}.. تذكير ودي 💼\nالدوام بكره الثلاثاء الصبح ✅\nنتمنى لك راحة تامة في باقي العيد ❤️`,
      label: "📋 الإثنين — 3ع"
    },
  ];
}

// ============================================================
// ✅ Sent Log — تسجيل النوتفكيشن بعد الإرسال في Firestore
// ============================================================
async function markAsSent(notificationId) {
  await db.collection(SENT_LOG_COLLECTION).doc(notificationId).set({
    sentAt: new Date().toISOString(),
    id: notificationId
  });
}

async function wasAlreadySent(notificationId) {
  const doc = await db.collection(SENT_LOG_COLLECTION).doc(notificationId).get();
  return doc.exists;
}

// ============================================================
// 🚑 MISSED NOTIFICATIONS RECOVERY
// بيتشتغل كل ما السيرفر يصحى أو كل ساعة
// بيشوف إيه اللي المفروض اتبعت ومتبعتش، ويبعته فوراً
// ============================================================
async function checkAndSendMissedNotifications() {
  const now = new Date();
  const schedule = getNotificationSchedule();

  console.log(`\n🔍 [Recovery Check] ${now.toLocaleString('ar-EG')} — بفحص النوتفكيشنز الفايتة...`);

  for (const notification of schedule) {
    // لو الوقت المحدد فات (مش جاي بعدين) ومش اتبعتت قبل كده
    if (notification.scheduledAt <= now) {
      const alreadySent = await wasAlreadySent(notification.id);

      if (!alreadySent) {
        console.log(`🚨 [Recovery] نوتفكيشن فايتة: ${notification.label} — بيبعت دلوقتي...`);
        try {
          await sendToAll(notification.title, notification.body);
          await markAsSent(notification.id);
          console.log(`✅ [Recovery] اتبعتت بنجاح: ${notification.label}`);
        } catch (err) {
          console.error(`❌ [Recovery] فشل: ${notification.label} — ${err.message}`);
        }
      } else {
        console.log(`✓ [Recovery] اتبعتت قبل كده: ${notification.label}`);
      }
    }
  }

  console.log(`✅ [Recovery Check] خلص الفحص.\n`);
}

// ============================================================
// ⏰ SCHEDULED EID NOTIFICATIONS
// ============================================================
function scheduleEidNotifications() {
  const schedule = getNotificationSchedule();

  console.log("\n📅 جدول نوتفكيشنز عيد الفطر 2026:");
  schedule.forEach(n => {
    console.log(`   ${n.label}: ${n.scheduledAt.toLocaleString()}`);
  });

  const { day0, day1, day2, day3, day4 } = getEidDates();

  // --- ليلة العيد ---
  cron.schedule(dateToCron(day0, 21), async () => {
    const id = "eid_eve_9pm";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [ليلة العيد] إرسال...");
    await sendToAll(`🌙 {company} تهنئكم بعيد الفطر المبارك`, `يا {name}.. كل عام وأنتم بخير 🌙\nعيد مبارك سعيد من كل فريق {company}!\nتقبل الله منا ومنكم صالح الأعمال ✨`);
    await markAsSent(id);
  });

  // --- أول يوم 8ص ---
  cron.schedule(dateToCron(day1, 8), async () => {
    const id = "eid_day1_8am";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [أول يوم صبح] إرسال دعاء...");
    await sendToAll(`🤲 دعاء العيد | {company}`, `يا {name}.. اللهم تقبل منا الصيام والقيام وصالح الأعمال 🤲\nوأعاده علينا وعليكم بالخير والبركات 🕌`);
    await markAsSent(id);
  });

  // --- أول يوم 12ظ ---
  cron.schedule(dateToCron(day1, 12), async () => {
    const id = "eid_day1_12pm";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [أول يوم ظهر] تهنئة...");
    await sendToAll(`🎉 عيد مبارك يا {name}!`, `كل سنة وانت طيب يا {name}! 🎊\nعساكم من عواده ❤️\n— فريق {company}`);
    await markAsSent(id);
  });

  // --- ثاني يوم 9ص ---
  cron.schedule(dateToCron(day2, 9), async () => {
    const id = "eid_day2_9am";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [ثاني يوم صبح]...");
    await sendToAll(`🌸 صباح الخير يا {name}!`, `صباح الفرحة والبركة من {company} 🌸\nاللهم اجعل أيامنا كلها خير وسعادة 💫`);
    await markAsSent(id);
  });

  // --- ثاني يوم 4ع ---
  cron.schedule(dateToCron(day2, 16), async () => {
    const id = "eid_day2_4pm";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [ثاني يوم عصر]...");
    await sendToAll(`😄 تذكير مهم من {company}!`, `يا {name}.. الكحك والبسكويت مش هيفضل للأبد 😂\nاستمتع بالعيد قبل ما يخلص! 🍪🎉`);
    await markAsSent(id);
  });

  // --- ثالث يوم 9ص ---
  cron.schedule(dateToCron(day3, 9), async () => {
    const id = "eid_day3_9am";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [ثالث يوم صبح]...");
    await sendToAll(`☀️ يا {name} إزيك في العيد؟`, `كل سنة وانت بخير يا {name} 😊\nنتمنالك إجازة حلوة مع أهلك وأحبابك ❤️\n— {company}`);
    await markAsSent(id);
  });

  // --- الإثنين 9ص ---
  cron.schedule(dateToCron(day4, 9), async () => {
    const id = "eid_day4_9am";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [الإثنين صبح] تذكير الشغل...");
    await sendToAll(`🏢 {company} | تذكير الدوام`, `يا {name}.. عيد مبارك! 🎉\nنذكركم إن أول يوم شغل هو يوم الثلاثاء إن شاء الله ✅\nاستمتع بباقي الإجازة 😊`);
    await markAsSent(id);
  });

  // --- الإثنين 3ع ---
  cron.schedule(dateToCron(day4, 15), async () => {
    const id = "eid_day4_3pm";
    if (await wasAlreadySent(id)) return;
    console.log("⏰ [الإثنين عصر] تأكيد موعد الشغل...");
    await sendToAll(`📋 {company} | تأكيد الدوام`, `يا {name}.. تذكير ودي 💼\nالدوام بكره الثلاثاء الصبح ✅\nنتمنى لك راحة تامة في باقي العيد ❤️`);
    await markAsSent(id);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔁 Recovery Cron — كل ساعة يفحص إيه اللي فات
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cron.schedule("0 * * * *", async () => {
    console.log("🔁 [Hourly Recovery] بيفحص النوتفكيشنز الفايتة...");
    await checkAndSendMissedNotifications();
  });

  console.log("✅ كل نوتفكيشنز عيد الفطر 2026 اتجدولت بنجاح!\n");
}

// ============================================================
// 📌 ENDPOINTS
// ============================================================

// تسجيل موظف
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

// ✅ Ping endpoint — UptimeRobot هيكلمه كل 14 دقيقة
app.get("/ping", (req, res) => {
  res.json({ status: "alive", time: new Date().toISOString() });
});

// ✅ Status endpoint — تشوف إيه اللي اتبعت وإيه اللي لسه
app.get("/status", async (req, res) => {
  try {
    const schedule = getNotificationSchedule();
    const now = new Date();
    const results = [];

    for (const n of schedule) {
      const sent = await wasAlreadySent(n.id);
      results.push({
        id: n.id,
        label: n.label,
        scheduledAt: n.scheduledAt.toLocaleString(),
        due: n.scheduledAt <= now,
        sent,
        status: sent ? "✅ اتبعت" : (n.scheduledAt <= now ? "⚠️ فاتت ومتبعتتش!" : "⏳ جاي")
      });
    }

    res.json({ now: now.toLocaleString(), notifications: results });
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

// إرسال لكل الموظفين
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
      if (err.code === "messaging/registration-token-not-registered") {
        await db.collection(USERS_COLLECTION).doc(user.name).delete();
        console.log(`🗑️ Removed expired token for ${user.name}`);
      }
    }
  }
  return results;
}

// ============================================================
// 🚀 START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 ${COMPANY} — Notification Server`);
  console.log(`📡 Running on port ${PORT}`);
  console.log(`🕒 Server Time: ${new Date().toLocaleString()}`);
  console.log(`🌍 Timezone: ${process.env.TZ || "NOT SET — ضيف TZ=Africa/Cairo في env!"}\n`);

  console.log(`📋 Endpoints:`);
  console.log(`   POST   /register      — تسجيل موظف`);
  console.log(`   GET    /users         — عرض المسجلين`);
  console.log(`   DELETE /users/:name   — حذف مستخدم`);
  console.log(`   GET    /ping          — Keep-alive (UptimeRobot)`);
  console.log(`   GET    /status        — حالة كل النوتفكيشنز`);
  console.log(`   POST   /send-test     — تيست بتوكن مباشر`);
  console.log(`   POST   /send-all      — إرسال لكل الموظفين`);
  console.log(`   POST   /send-user     — إرسال لموظف معين\n`);

  scheduleEidNotifications();

  // ✅ فور ما السيرفر يصحى، يفحص النوتفكيشنز الفايتة فوراً
  console.log("🔍 فحص النوتفكيشنز الفايتة بعد الـ startup...");
  await checkAndSendMissedNotifications();
});
