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
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
});

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
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // NOTE: si ton front est sur le même domaine, tu peux mettre lax même en prod.
      sameSite: IS_PROD ? "none" : "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7,
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

// =====================================================
// ✅ INIT DB AUTO AU BOOT (plus besoin de /_init_db)
// =====================================================
async function initDb() {
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

  // pending signup persisté (plus de perte au restart)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_signups (
      id UUID PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(64) NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // séquence PhantomID
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS phantom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
  `);

  // recale la séquence sur le max existant
  await pool.query(`
    SELECT setval(
      'phantom_id_seq',
      COALESCE((
        SELECT MAX(CAST(SUBSTRING(phantom_id FROM 3) AS INT)) FROM users
      ), 0)
    );
  `);

  console.log("✅ DB init OK (users + pending_signups + phantom_id_seq)");
}

// ✅ PhantomID SEQ: PH000001, PH000002, ...
async function nextPhantomId(client = pool) {
  const r = await client.query("SELECT nextval('phantom_id_seq') AS n");
  const n = Number(r.rows[0].n);
  return `PH${String(n).padStart(6, "0")}`;
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

// (Optionnel) tu peux garder /_init_db si tu veux, mais plus nécessaire
app.get("/_init_db", async (req, res) => {
  try {
    await initDb();
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "init db failed" });
  }
});

// =====================================================
// 1) SIGNUP START (pending en DB + id en session)
// =====================================================
app.post("/signup/start", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const emailKey = normalizeEmail(email);

    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [
      emailKey,
    ]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "Email already used" });
    }

    // empêche plusieurs pending pour le même email
    const existsPending = await pool.query(
      "SELECT id FROM pending_signups WHERE email = $1",
      [emailKey]
    );
    if (existsPending.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "Signup pending already exists" });
    }

    const pendingId = cryptoRandomUUID();
    const passwordHash = await bcrypt.hash(String(password), 12);

    await pool.query(
      `INSERT INTO pending_signups (id, email, username, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [pendingId, emailKey, String(username).trim(), passwordHash]
    );

    req.session.pendingSignupId = pendingId;

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// petit helper uuid (sans lib)
function cryptoRandomUUID() {
  // Node 18+ a crypto.randomUUID, mais on garde simple ESM
  // eslint-disable-next-line no-undef
  return (globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }));
}

// =====================================================
// 2) DISCORD AUTH
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
// - pending signup => crée user en DB avec PH000001+
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;

    if (error) return res.redirect(frontUrl("/index.html?discord=error"));
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
      return res.redirect(frontUrl("/index.html?discord=error"));
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
      return res.redirect(frontUrl("/index.html?discord=error"));
    }

    const me = await meResp.json();
    const discordUserId = me.id;

    // 3) Add to guild (si ça fail, on log mais on continue — pas bloquant pour créer le compte)
    try {
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
      }
    } catch (e) {
      console.error("ADD GUILD EX:", e);
    }

    // 4) Add role (si ça fail, on log mais on continue)
    try {
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
      }
    } catch (e) {
      console.error("ADD ROLE EX:", e);
    }

    // ===== A) pending signup => create user in DB =====
    const pendingId = req.session.pendingSignupId;

    if (pendingId) {
      const p = await pool.query(
        "SELECT email, username, password_hash FROM pending_signups WHERE id = $1",
        [pendingId]
      );

      if (p.rowCount === 0) {
        delete req.session.pendingSignupId;
        return res.redirect(frontUrl("/index.html?discord=error"));
      }

      const pending = p.rows[0];

      // email déjà utilisé ?
      const exists = await pool.query("SELECT id FROM users WHERE email = $1", [
        pending.email,
      ]);
      if (exists.rowCount > 0) {
        await pool.query("DELETE FROM pending_signups WHERE id = $1", [pendingId]);
        delete req.session.pendingSignupId;
        return res.redirect(frontUrl("/index.html?signup=email_used"));
      }

      // transaction pour éviter bugs
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const phantomId = await nextPhantomId(client);

        const ins = await client.query(
          `INSERT INTO users (phantom_id, email, password_hash, discord_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [phantomId, pending.email, pending.password_hash, discordUserId]
        );

        await client.query("DELETE FROM pending_signups WHERE id = $1", [pendingId]);

        await client.query("COMMIT");

        req.session.userId = ins.rows[0].id;
        delete req.session.pendingSignupId;

        return res.redirect(frontUrl("/phantomcard.html?signup=done"));
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("CREATE USER TX ERROR:", e);
        return res.redirect(frontUrl("/index.html?discord=error"));
      } finally {
        client.release();
      }
    }

    // ===== B) user déjà logged => link discord_id =====
    if (req.session?.userId) {
      await pool.query("UPDATE users SET discord_id = $1 WHERE id = $2", [
        discordUserId,
        req.session.userId,
      ]);
      return res.redirect(frontUrl("/phantomcard.html?discord=linked"));
    }

    // aucun pending + pas logged
    return res.redirect(frontUrl("/index.html?discord=linked"));
  } catch (e) {
    console.error("CALLBACK ERROR:", e);
    return res.redirect(frontUrl("/index.html?discord=error"));
  }
});

// =====================================================
// 4) LOGIN
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
// 5) /me (PhantomCard)
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
        phantomId: u.phantom_id,
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
initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`PhantomID running on port ${PORT}`);
      console.log("NODE_ENV:", process.env.NODE_ENV);
      console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
      console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
    });
  })
  .catch((e) => {
    console.error("❌ initDb failed:", e);
    process.exit(1);
  });
