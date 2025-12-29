import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Path (ESM) =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // Render/HTTPS => true
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

app.use(express.static("public"));

// ===== SQLite init =====
const dbPath = path.join(__dirname, "phantomid.db");
const db = new sqlite3.Database(dbPath);

// Helpers Promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Create tables + meta
async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phantomId TEXT UNIQUE,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      discordUserId TEXT,
      verifiedDiscord INTEGER NOT NULL DEFAULT 0,
      premium INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const row = await get(`SELECT value FROM meta WHERE key = ?`, ["phantomCounter"]);
  if (!row) {
    await run(`INSERT INTO meta (key, value) VALUES (?, ?)`, ["phantomCounter", "1"]);
  }
}

// Generate unique sequential PH000001 from DB counter (transaction)
async function allocatePhantomId() {
  await run("BEGIN IMMEDIATE");
  try {
    const row = await get(`SELECT value FROM meta WHERE key = ?`, ["phantomCounter"]);
    const current = row ? parseInt(row.value, 10) : 1;

    const phantomId = `PH${String(current).padStart(6, "0")}`;
    const next = current + 1;

    await run(`UPDATE meta SET value = ? WHERE key = ?`, [String(next), "phantomCounter"]);
    await run("COMMIT");

    return phantomId;
  } catch (e) {
    try {
      await run("ROLLBACK");
    } catch {}
    throw e;
  }
}

// ===== In-memory pending signup (ok pour beta) =====
const pendingSignups = {}; // pendingId -> { username,email,passwordPlain,createdAt }

function newId(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function requireAuthJson(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ ok: false, error: "Not logged in" });
  next();
}

function looksLikeBcryptHash(str) {
  // bcrypt hashes start with $2a$, $2b$, $2y$ etc.
  return typeof str === "string" && str.startsWith("$2");
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

/* =====================================================
   1) SIGNUP START (pending, pas encore de compte)
===================================================== */
app.post("/signup/start", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const emailKey = String(email).toLowerCase().trim();

    // check email exists in DB
    const exists = await get(`SELECT id FROM users WHERE email = ?`, [emailKey]);
    if (exists) {
      return res.status(409).json({ ok: false, error: "Email already used" });
    }

    const pendingId = newId("pending");
    pendingSignups[pendingId] = {
      username: String(username).trim(),
      email: emailKey,
      passwordPlain: String(password), // on hash plus tard (après Discord)
      createdAt: Date.now(),
    };

    req.session.pendingId = pendingId;
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* =====================================================
   2) DISCORD AUTH
===================================================== */
app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent("identify guilds.join");
  const state = Math.random().toString(16).slice(2);

  req.session.discordState = state;

  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${process.env.DISCORD_CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&prompt=consent` +
    `&state=${state}`;

  return res.redirect(url);
});

/* =====================================================
   3) DISCORD CALLBACK
   - join server + role
   - SI pending signup existe -> crée le compte EN DB + login + redirect phantomcard
===================================================== */
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;

    if (error) {
      return res
        .status(400)
        .send(`Discord OAuth error: ${error}${error_description ? " - " + error_description : ""}`);
    }

    if (!code) return res.status(400).send("No code returned by Discord.");

    if (!state || state !== req.session.discordState) {
      return res.status(400).send("Invalid state (security check failed).");
    }

    // 1) Exchange code -> token
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error("TOKEN ERROR:", err);
      return res.status(500).send("Token exchange failed: " + err);
    }

    const tokenData = await tokenResp.json();
    const userAccessToken = tokenData.access_token;

    // 2) Get user identity
    const meResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });

    if (!meResp.ok) {
      const err = await meResp.text();
      console.error("ME ERROR:", err);
      return res.status(500).send("Get /users/@me failed: " + err);
    }

    const me = await meResp.json();
    const discordUserId = me.id;

    // 3) Add to guild
    const addResp = await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: userAccessToken }),
      }
    );

    if (!addResp.ok) {
      const err = await addResp.text();
      console.error("ADD GUILD ERROR:", err);
      return res.status(500).send("Add guild member failed: " + err);
    }

    // 4) Add role PhantomID
    const roleResp = await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${process.env.DISCORD_PHANTOM_ROLE_ID}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      }
    );

    if (!roleResp.ok) {
      const err = await roleResp.text();
      console.error("ADD ROLE ERROR:", err);
      return res.status(500).send("Add role failed: " + err);
    }

    // ===== Create account if pending =====
    const pendingId = req.session.pendingId;
    if (pendingId && pendingSignups[pendingId]) {
      const pending = pendingSignups[pendingId];

      // Email already used?
      const exists = await get(`SELECT id FROM users WHERE email = ?`, [pending.email]);
      if (exists) {
        delete pendingSignups[pendingId];
        delete req.session.pendingId;
        return res.status(409).send("Email already used.");
      }

      // Allocate PhantomID (persistent counter)
      const phantomId = await allocatePhantomId();
      const userId = newId("user");

      // ✅ HASH password NOW
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(pending.passwordPlain, saltRounds);

      await run(
        `INSERT INTO users
          (id, phantomId, username, email, password, discordUserId, verifiedDiscord, premium, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          phantomId,
          pending.username,
          pending.email,
          passwordHash,
          discordUserId,
          1,
          0,
          Date.now(),
        ]
      );

      delete pendingSignups[pendingId];
      delete req.session.pendingId;

      req.session.userId = userId;

      return res.redirect("/phantomcard.html?signup=done");
    }

    return res.redirect("/index.html?discord=linked");
  } catch (e) {
    console.error(e);
    return res.status(500).send("Unexpected server error: " + String(e));
  }
});

/* =====================================================
   4) LOGIN (bcrypt)
===================================================== */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailKey = String(email || "").toLowerCase().trim();
    const pass = String(password || "");

    if (!emailKey || !pass) return res.status(400).json({ ok: false, error: "Missing fields" });

    const user = await get(`SELECT id, password FROM users WHERE email = ?`, [emailKey]);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    const stored = String(user.password || "");
    let ok = false;

    if (looksLikeBcryptHash(stored)) {
      ok = await bcrypt.compare(pass, stored);
    } else {
      // ✅ Compat: ancien compte en clair
      ok = stored === pass;

      // Upgrade automatique vers bcrypt si c’est bon
      if (ok) {
        const upgradedHash = await bcrypt.hash(pass, 12);
        await run(`UPDATE users SET password = ? WHERE id = ?`, [upgradedHash, user.id]);
      }
    }

    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    req.session.userId = user.id;
    return res.json({ ok: true, redirectTo: "/phantomcard.html" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* =====================================================
   5) WHO AM I (JSON)
===================================================== */
app.get("/me", requireAuthJson, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await get(
      `SELECT id, phantomId, username, email, verifiedDiscord, premium, createdAt
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        phantomId: user.phantomId,
        username: user.username,
        email: user.email,
        verifiedDiscord: !!user.verifiedDiscord,
        premium: !!user.premium,
        createdAt: user.createdAt,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* =====================================================
   6) LOGOUT
===================================================== */
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ===== Start server =====
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 PhantomID running on http://localhost:${PORT}`);
      console.log(`🗄️ SQLite DB: ${dbPath}`);
    });
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
