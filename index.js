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
app.use(express.urlencoded({ extended: true })); // HTML forms
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || ""; // optionnel

function frontUrl(path = "/") {
  if (!FRONTEND_BASE_URL) return path; // sert public/ directement
  return `${FRONTEND_BASE_URL}${path}`;
}

// ===== Pending TTL =====
const PENDING_TTL_MS = 1000 * 60 * 20; // 20 minutes
function isPendingExpired(p) {
  const t = Number(p?.createdAt || 0);
  return !t || Date.now() - t > PENDING_TTL_MS;
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
      sameSite: IS_PROD ? "none" : "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

// =====================================================
// Static files
// =====================================================
app.use(express.static("public"));

// ===== Clean URLs (no .html) =====
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.get("/settings", (req, res) => {
  res.sendFile("settings.html", { root: "public" });
});

app.get("/phantomcard", (req, res) => {
  res.sendFile("phantomcard.html", { root: "public" });
});

app.get("/tournaments", (req, res) => {
  res.sendFile("tournaments.html", { root: "public" });
});

app.get("/rating-system", (req, res) => {
  res.sendFile("rating-system.html", { root: "public" });
});

app.get("/creator-access", (req, res) => {
  res.sendFile("creator-access-registrer.html", { root: "public" });
});

// (Optionnel mais conseillé) : si quelqu’un tape .html, on redirige vers l’URL propre
app.get("/*.html", (req, res) => {
  const clean = req.path.replace(/\.html$/i, "");
  return res.redirect(301, clean || "/");
});

// ===== Helpers =====
function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

// ✅ PhantomID SEQ: PH000001, PH000002, ...
async function nextPhantomId() {
  try {
    const r = await pool.query("SELECT nextval('phantom_id_seq') AS n");
    const n = Number(r.rows[0].n);
    return `PH${String(n).padStart(6, "0")}`;
  } catch (e) {
    console.error("❌ nextPhantomId error:", e);
    throw new Error("phantom_id_seq missing (initDb not executed?)");
  }
}

// =====================================================
// INIT DB AU DÉMARRAGE (table + column + sequence + setval safe)
// + constraints anti doublons discord_id
// + rating (default Unrated)
// + avatar default + badges (premium/verified/builder)
// =====================================================
async function initDb() {
  // 1) table users (première création)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phantom_id VARCHAR(32) UNIQUE NOT NULL,
      username VARCHAR(32),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      discord_id VARCHAR(32),
      rating VARCHAR(32) DEFAULT 'Unrated',
      avatar_url TEXT DEFAULT '/assets/phantomid-logo.png',
      is_premium BOOLEAN DEFAULT FALSE,
      is_verified BOOLEAN DEFAULT FALSE,
      is_builder BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 1b) si table existait AVANT username -> ajouter colonne safe
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username VARCHAR(32);
  `);

  // 1c) unique discord_id (nullable => OK)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_discord_id_unique'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_discord_id_unique UNIQUE (discord_id);
      END IF;
    END $$;
  `);

  // 1d) rating (nullable mais default = Unrated) + backfill anciens users
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rating VARCHAR(32) DEFAULT 'Unrated';
  `);

  await pool.query(`
    UPDATE users
    SET rating = 'Unrated'
    WHERE rating IS NULL;
  `);

  // 1e) avatar + badges (defaults) + backfill anciens users
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '/assets/phantomid-logo.png';
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_builder BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    UPDATE users
    SET avatar_url = '/assets/phantomid-logo.png'
    WHERE avatar_url IS NULL OR avatar_url = '';
  `);

  await pool.query(`
    UPDATE users
    SET is_premium = FALSE
    WHERE is_premium IS NULL;
  `);

  await pool.query(`
    UPDATE users
    SET is_verified = FALSE
    WHERE is_verified IS NULL;
  `);

  await pool.query(`
    UPDATE users
    SET is_builder = FALSE
    WHERE is_builder IS NULL;
  `);

  // 2) sequence phantom_id_seq (min 1)
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS phantom_id_seq
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1;
  `);

  // 3) recaler la sequence sur le max PHxxxxxx existant
  const maxRes = await pool.query(`
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(phantom_id FROM 3) AS INT)),
      0
    ) AS max_n
    FROM users;
  `);

  const maxN = Number(maxRes.rows[0].max_n || 0);

  if (maxN < 1) {
    // IMPORTANT: ne jamais setval à 0 si MINVALUE=1
    // is_called=false => nextval renvoie exactement 1
    await pool.query(`SELECT setval('phantom_id_seq', 1, false);`);
  } else {
    // is_called=true => nextval renvoie maxN + 1
    await pool.query(`SELECT setval('phantom_id_seq', $1, true);`, [maxN]);
  }

  console.log("✅ initDb ok. max phantom =", maxN);
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

// =====================================================
// 1) SIGNUP START (pending en session, pas de compte encore)
// =====================================================
app.post("/signup/start", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const emailKey = normalizeEmail(email);

    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [emailKey]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "Email already used" });
    }

    // reset pending (propre)
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
// - hardening: TTL pending, idempotence discord_id, anti-vol, transaction create
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;

    if (error) return res.redirect(frontUrl("/?discord=error"));
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
      return res.redirect(frontUrl("/?discord=error"));
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
      return res.redirect(frontUrl("/?discord=error"));
    }

    const me = await meResp.json();
    const discordUserId = me.id;

    const pending = req.session.pendingSignup;

    // A) pending expiré => cleanup
    if (pending && isPendingExpired(pending)) {
      delete req.session.pendingSignup;
      return res.redirect(frontUrl("/?signup=expired"));
    }

    // B) Si user déjà logged => link discord_id (avec check anti-vol)
    if (req.session?.userId) {
      const taken = await pool.query(
        "SELECT id FROM users WHERE discord_id = $1 AND id <> $2 LIMIT 1",
        [discordUserId, req.session.userId]
      );

      if (taken.rowCount > 0) {
        return res.redirect(frontUrl("/phantomcard?discord=already_linked"));
      }

      await pool.query("UPDATE users SET discord_id = $1 WHERE id = $2", [
        discordUserId,
        req.session.userId,
      ]);

      // Add to guild
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
        return res.redirect(frontUrl("/?discord=error"));
      }

      // Add role
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
        return res.redirect(frontUrl("/?discord=error"));
      }

      return res.redirect(frontUrl("/phantomcard?discord=linked"));
    }

    // C) Idempotence: si ce discord_id existe déjà -> log in ce user
    const existingByDiscord = await pool.query(
      "SELECT id FROM users WHERE discord_id = $1 LIMIT 1",
      [discordUserId]
    );

    if (existingByDiscord.rowCount > 0) {
      req.session.userId = existingByDiscord.rows[0].id;
      delete req.session.pendingSignup;

      // Add to guild
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
        return res.redirect(frontUrl("/?discord=error"));
      }

      // Add role
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
        return res.redirect(frontUrl("/?discord=error"));
      }

      return res.redirect(frontUrl("/phantomcard?discord=linked"));
    }

    // D) pending signup => create user (transaction)
    if (pending?.email && pending?.password) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Re-check email (anti race)
        const existsEmail = await client.query(
          "SELECT id FROM users WHERE email = $1 LIMIT 1",
          [pending.email]
        );

        if (existsEmail.rowCount > 0) {
          await client.query("ROLLBACK");
          delete req.session.pendingSignup;
          return res.redirect(frontUrl("/?signup=email_used"));
        }

        // PhantomID dans le même client (transaction-safe)
        const r = await client.query("SELECT nextval('phantom_id_seq') AS n");
        const n = Number(r.rows[0].n);
        const phantomId = `PH${String(n).padStart(6, "0")}`;

        const passwordHash = await bcrypt.hash(pending.password, 12);

        // rating/avatar/badges: pas besoin de les insérer (DEFAULT côté DB)
        const ins = await client.query(
          `INSERT INTO users (phantom_id, username, email, password_hash, discord_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [phantomId, pending.username, pending.email, passwordHash, discordUserId]
        );

        await client.query("COMMIT");

        req.session.userId = ins.rows[0].id;
        delete req.session.pendingSignup;

        // Add to guild
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
          return res.redirect(frontUrl("/?discord=error"));
        }

        // Add role
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
          return res.redirect(frontUrl("/?discord=error"));
        }

        return res.redirect(frontUrl("/phantomcard?signup=done"));
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {}

        const msg = String(e?.message || "");

        if (msg.includes("users_discord_id_unique")) {
          return res.redirect(frontUrl("/?discord=already_linked"));
        }
        if (msg.includes("users_email_key")) {
          return res.redirect(frontUrl("/?signup=email_used"));
        }

        console.error("❌ create user tx error:", e);
        return res.redirect(frontUrl("/?discord=error"));
      } finally {
        client.release();
      }
    }

    // E) Rien à créer / lier => retour home
    return res.redirect(frontUrl("/?discord=linked"));
  } catch (e) {
    console.error("❌ discord callback error:", e);
    return res.redirect(frontUrl("/?discord=error"));
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

    const q = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [emailKey]);

    if (q.rowCount === 0) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    const user = q.rows[0];
    const ok = await bcrypt.compare(pass, user.password_hash);

    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    req.session.userId = user.id;
    return res.json({ ok: true, redirectTo: "/phantomcard" }); // URL propre
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================================================
// 5) /me (PhantomCard)
// =====================================================
app.get("/me", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not logged in" });
    }

    const q = `
      SELECT id, username, phantom_id, email, discord_id, rating,
             avatar_url, is_premium, is_verified, is_builder
      FROM users
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [userId]);

    if (r.rowCount === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ ok: false, error: "Session invalid" });
    }

    const u = r.rows[0];

    const avatarUrl =
      (u.avatar_url && String(u.avatar_url).trim()) || "/assets/phantomid-logo.png";

    return res.json({
      ok: true,
      user: {
        id: u.id,
        username: u.username,
        phantomId: u.phantom_id,
        email: u.email,
        discordId: u.discord_id || null,
        verifiedDiscord: !!u.discord_id,
        rating: u.rating || "Unrated",

        avatarUrl,
        badges: {
          premium: !!u.is_premium,
          verified: !!u.is_verified,
          builder: !!u.is_builder,
        },
      },
    });
  } catch (e) {
    console.error("GET /me error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================================================
// SETTINGS: Update username
// =====================================================
app.post("/account/username", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "Not logged in" });

    const username = String(req.body?.username || "").trim();

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ ok: false, error: "Username must be 3-20 chars" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ ok: false, error: "Only letters, numbers, underscore" });
    }

    await pool.query("UPDATE users SET username = $1 WHERE id = $2", [username, userId]);
    return res.json({ ok: true });
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ ok: false, error: "Username already taken" });
    }
    console.error("POST /account/username error:", e);
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
(async () => {
  try {
    await initDb();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`PhantomID running on port ${PORT}`);
      console.log("NODE_ENV:", process.env.NODE_ENV);
      console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
      console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
    });
  } catch (e) {
    console.error("❌ initDb failed, server not started:", e);
    process.exit(1);
  }
})();
