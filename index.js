import express from "express";
import dotenv from "dotenv";
import session from "express-session";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
      secure: false, // en prod Render -> true (HTTPS) si tu mets derrière proxy, sinon laisse false pour beta
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

app.use(express.static("public"));

// ===== "DB" temporaire en mémoire (beta) =====
const pendingSignups = {}; // pendingId -> { username,email,password,createdAt }
const users = {}; // userId -> user data
const usersByEmail = {}; // email -> userId

function newId(prefix = "u") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function requireAuth(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ ok: false, error: "Not logged in" });
  next();
}

// ===== Health =====
app.get("/health", (req, res) => res.send("ok"));

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

  // on garde le pendingId dans session (c’est important)
  req.session.pendingId = pendingId;

  return res.json({ ok: true });
});

// =====================================================
// 2) DISCORD AUTH (redirige Discord)
// =====================================================
app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent("identify guilds.join");
  const state = Math.random().toString(16).slice(2);

  // on stock state pour sécurité
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

// =====================================================
// 3) DISCORD CALLBACK
// - join server + role
// - SI pending signup existe -> crée le compte + login + redirect phantomcard
// =====================================================
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;

    if (error) {
      return res
        .status(400)
        .send(
          `Discord OAuth error: ${error}${error_description ? " - " + error_description : ""}`
        );
    }

    if (!code) return res.status(400).send("No code returned by Discord.");

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

    // ===== SI pending signup -> on crée le compte ici =====
    const pendingId = req.session.pendingId;
    if (pendingId && pendingSignups[pendingId]) {
      const pending = pendingSignups[pendingId];

      // Email déjà utilisé ?
      if (usersByEmail[pending.email]) {
        delete pendingSignups[pendingId];
        delete req.session.pendingId;
        return res.status(409).send("Email already used.");
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

      // redirect final beta
      return res.redirect("/phantomcard.html?signup=done");
    }

    // sinon juste rediriger overlay
    return res.redirect("/index.html?discord=linked");
  } catch (e) {
    console.error(e);
    res.status(500).send("Unexpected server error: " + String(e));
  }
});

// =====================================================
// 4) LOGIN
// =====================================================
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const emailKey = String(email || "").toLowerCase().trim();
  const pass = String(password || "");

  if (!emailKey || !pass) return res.status(400).json({ ok: false, error: "Missing fields" });

  const userId = usersByEmail[emailKey];
  if (!userId) return res.status(401).json({ ok: false, error: "Invalid login" });

  const user = users[userId];
  if (!user || user.password !== pass) {
    return res.status(401).json({ ok: false, error: "Invalid login" });
  }

  req.session.userId = user.id;
  return res.json({ ok: true });
});

// =====================================================
// 5) WHO AM I
// =====================================================
app.get("/me", requireAuth, (req, res) => {
  const user = users[req.session.userId];
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
});
