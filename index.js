import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// IMPORTANT reverse proxy (Render)
app.set("trust proxy", 1);

// ===== Middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || ""; // optionnel

function frontUrl(path = "/") {
  if (!FRONTEND_BASE_URL) return path; // sert public/ directement
  return `${FRONTEND_BASE_URL}${path}`;
}

// ===== Postgres =====
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL manquant (Render Postgres). Mets-le dans les env vars.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false, // Render = SSL requis en prod
});

// petite sanity check (log seulement)
pool
  .query("SELECT 1")
  .then(() => console.log("✅ PostgreSQL connecté"))
  .catch((e) => console.error("❌ PostgreSQL connexion fail:", e));

// ===== Session store Postgres =====
const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      // auto-create table si elle existe pas (connect-pg-simple sait la créer)
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: IS_PROD ? "none" : "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

// Static files
app.use(express.static("public"));

// ===== Helpers =====
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

// Génère un PhantomID simple: PH + 6 digits (unique)
async function generateUniquePhantomId() {
  for (let i = 0; i < 8; i++) {
    const num = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    const phantomId = `PH${num}`;

    const check = await pool.query("SELECT 1 FROM users WHERE phantom_id = $1", [
      phantomId,
    ]);
    if (check.rowCount === 0) return phantomId;
  }
  // fallback si malchance
  return `PH${Date.now().toString().slice(-6)}`;
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

// =====================================================
// 0) INIT DB (facultatif) - crée la table users si absente
// (tu l’as déjà fait dans DBeaver, mais on garde safe)
// =====================================================
app.get("/_init_db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phantom_id VARCHAR(32) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        discord_id VARCHAR(32),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "init db failed" });
  }
});

// =====================================================
// 1) SIGNUP START (pending en session, pas de compte encore)
// =====================================================
app.post("/signup/start", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // username est dans ton overlay, on le garde, mais
    // ta table users n'a pas username pour l'instant.
    // Donc on le garde en session pour plus tard si tu veux l'ajouter au DB.
    if (!username || !email || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const emailKey = normalizeEmail(email);

    // check email existant
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [
      emailKey,
    ]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "Email already used" });
    }

    // stock pending dans session
    req.session.pendingSignup = {
      username: String(username).trim(),
      email: emailKey,
      password: String(password),
      createdAt: Date.now(),
    };

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================================================
// 2) DISCORD AUTH (redirige Discord)
// =====================================================
app.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!redirectUri) {
    return res.status(500).send("Missing DISCORD_REDIRECT_URI in env.");
  }

  const scope = "identify guilds.join";
  const state = Math.random().toString(16).slice(2);
  req.session.discordState = state;

  const url =
    `https://discord.com/oauth2/authorize` +
    `?client_id=${encodeURIComponent(process.env.DISCORD_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(state)}`;

  return res.redirect(url);
});

// =====================================================
// 3) DISCORD CALLBACK
// - join server + role
// - si pending signup => crée user en DB + login + redirect phantomcard
// - sinon si déjà logged => update discord_id (link) + redirect phantomcard
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;

    console.log("DISCORD CALLBACK query:", req.query);

    if (error) {
      return res.redirect(frontUrl("/index.html?discord=error"));
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

    // 2) Get user
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

    // 4) Add role
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

    // ===== A) pending signup => create user in DB =====
    const pending = req.session.pendingSignup;

    if (pending?.email && pending?.password) {
      // re-check email (sécurité)
      const exists = await pool.query("SELECT id FROM users WHERE email = $1", [
        pending.email,
      ]);
      if (exists.rowCount > 0) {
        delete req.session.pendingSignup;
        return res.redirect(frontUrl("/index.html?signup=email_used"));
      }

      const phantomId = await generateUniquePhantomId();
      const passwordHash = await bcrypt.hash(pending.password, 12);

      const ins = await pool.query(
        `INSERT INTO users (phantom_id, email, password_hash, discord_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [phantomId, pending.email, passwordHash, discordUserId]
      );

      // login
      req.session.userId = ins.rows[0].id;

      // cleanup pending
      delete req.session.pendingSignup;

      // redirect phantomcard (overlay flow OK)
      return res.redirect(frontUrl("/phantomcard.html?signup=done"));
    }

    // ===== B) user déjà logged => simple link discord_id =====
    if (req.session?.userId) {
      await pool.query("UPDATE users SET discord_id = $1 WHERE id = $2", [
        discordUserId,
        req.session.userId,
      ]);
      return res.redirect(frontUrl("/phantomcard.html?discord=linked"));
    }

    // ===== C) neither pending nor logged => just come back home
    return res.redirect(frontUrl("/index.html?discord=linked"));
  } catch (e) {
    console.error(e);
    return res.redirect(frontUrl("/index.html?discord=error"));
  }
});

// =====================================================
// 4) LOGIN (overlay -> fetch POST)
// =====================================================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailKey = normalizeEmail(email);
    const pass = String(password || "");

    if (!emailKey || !pass) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const q = await pool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [emailKey]
    );

    if (q.rowCount === 0) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    const user = q.rows[0];
    const ok = await bcrypt.compare(pass, user.password_hash);

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

// =====================================================
// 5) WHO AM I  (pour afficher PhantomID sur la PhantomCard)
// =====================================================
app.get("/me", requireAuth, async (req, res) => {
  try {
    const q = await pool.query(
      "SELECT id, phantom_id, email, discord_id FROM users WHERE id = $1",
      [req.session.userId]
    );

    if (q.rowCount === 0) {
      return res.status(401).json({ ok: false, error: "Not logged in" });
    }

    const u = q.rows[0];

    return res.json({
      ok: true,
      user: {
        id: u.id,
        phantomId: u.phantom_id, // IMPORTANT: phantomId (camelCase) pour ton front
        email: u.email,
        discordId: u.discord_id || null,
        verifiedDiscord: !!u.discord_id,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================================================
// 6) LOGOUT
// =====================================================
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ===== Start server =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PhantomID running on port ${PORT}`);
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
  console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
});
