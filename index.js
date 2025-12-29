import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// IMPORTANT Render / reverse proxy
app.set("trust proxy", 1);

// ===== Middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Helper env
const IS_PROD = process.env.NODE_ENV === "production";

// Ton front (si tu sers le front ailleurs, ex: phantomid.com)
// sinon laisse vide => express.static("public")
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "";

// ===== Session =====
app.use(
  session({
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

// ===== "DB" temporaire en mémoire (beta) =====
const pendingSignups = {}; // pendingId -> { username,email,password,createdAt }
const users = {}; // userId -> user data
const usersByEmail = {}; // email -> userId

function newId(prefix = "u") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// helper: construit une URL vers le front (si FRONTEND_BASE_URL est set)
function frontUrl(pathAndQuery) {
  if (FRONTEND_BASE_URL) return `${FRONTEND_BASE_URL}${pathAndQuery}`;
  return pathAndQuery;
}

// helper: retourne toujours sur index (puis overlay gère via query params)
function goHome(queryString) {
  const qs = queryString ? `?${queryString}` : "";
  return frontUrl(`/index.html${qs}`);
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

// Optionnel: évite l’écran "Cannot GET /login" si quelqu’un tape l’URL
app.get("/login", (req, res) => res.redirect(goHome("login=required")));

// =====================================================
// 1) SIGNUP START (on ne crée PAS le compte ici)
// =====================================================
app.post("/signup/start", (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const emailKey = String(email).toLowerCase().trim();
  if (usersByEmail[emailKey]) {
    return res.status(409).json({ ok: false, error: "Email already used" });
  }

  const pendingId = newId("pending");
  pendingSignups[pendingId] = {
    username: String(username).trim(),
    email: emailKey,
    password: String(password), // beta: en prod -> hash
    createdAt: Date.now(),
  };

  // IMPORTANT: on garde pendingId en session
  req.session.pendingId = pendingId;

  return res.json({ ok: true });
});

// =====================================================
// 2) DISCORD AUTH (redirige Discord)
// =====================================================
app.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!redirectUri) return res.status(500).send("Missing DISCORD_REDIRECT_URI in env.");
  if (!process.env.DISCORD_CLIENT_ID) return res.status(500).send("Missing DISCORD_CLIENT_ID in env.");

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
// - SI pending signup existe -> crée le compte + login + redirect home
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;

    console.log("DISCORD CALLBACK query:", req.query);

    if (error) {
      // retour home avec erreur (overlay peut lire discord=error)
      return res.redirect(goHome(`discord=error`));
    }

    if (!code) {
      // pas de code => erreur
      return res.redirect(goHome(`discord=error`));
    }

    // check state
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
        redirect_uri: process.env.DISCORD_REDIRECT_URI, // MUST match exactly
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error("TOKEN ERROR:", err);
      return res.redirect(goHome(`discord=error`));
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
      return res.redirect(goHome(`discord=error`));
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
      return res.redirect(goHome(`discord=error`));
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
      return res.redirect(goHome(`discord=error`));
    }

    // ===== SI pending signup -> on crée le compte ici =====
    const pendingId = req.session.pendingId;

    if (pendingId && pendingSignups[pendingId]) {
      const pending = pendingSignups[pendingId];

      if (usersByEmail[pending.email]) {
        delete pendingSignups[pendingId];
        delete req.session.pendingId;
        return res.redirect(goHome(`signup=error&reason=email_used`));
      }

      const userId = newId("user");
      users[userId] = {
        id: userId,
        username: pending.username,
        email: pending.email,
        password: pending.password, // beta: en prod -> hash
        discordUserId,
        verifiedDiscord: true,
        createdAt: Date.now(),
        premium: false,
      };
      usersByEmail[pending.email] = userId;

      // cleanup
      delete pendingSignups[pendingId];
      delete req.session.pendingId;

      // login auto
      req.session.userId = userId;

      // ✅ IMPORTANT: retour sur index (overlays)
      // discord=linked déclenche ton linking.js
      // signup=done si tu veux afficher un overlay "account created"
      return res.redirect(goHome(`signup=done&discord=linked`));
    }

    // Sinon: simple linking → retour sur index
    return res.redirect(goHome(`discord=linked`));
  } catch (e) {
    console.error(e);
    return res.redirect(goHome(`discord=error`));
  }
});

// =====================================================
// 4) LOGIN (overlay -> fetch POST)
// =====================================================
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const emailKey = String(email || "").toLowerCase().trim();
  const pass = String(password || "");

  if (!emailKey || !pass) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  const userId = usersByEmail[emailKey];
  if (!userId) return res.status(401).json({ ok: false, error: "Invalid login" });

  const user = users[userId];
  if (!user || user.password !== pass) {
    return res.status(401).json({ ok: false, error: "Invalid login" });
  }

  req.session.userId = user.id;

  // Ton overlay login.js attend redirectTo
  return res.json({ ok: true, redirectTo: "/phantomcard.html" });
});

// =====================================================
// 5) WHO AM I
// =====================================================
app.get("/me", requireAuth, (req, res) => {
  const user = users[req.session.userId];
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });

  return res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      verifiedDiscord: user.verifiedDiscord,
      premium: user.premium,
    },
  });
});

// =====================================================
// 6) LOGOUT
// =====================================================
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ===== Start server =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PhantomID running on port ${PORT}`);
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("FRONTEND_BASE_URL:", FRONTEND_BASE_URL || "(serving static)");
  console.log("DISCORD_REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI);
});
