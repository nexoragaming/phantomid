// setting.js
// Page test (overlay) — remplit Account Info depuis /me et gère actions de base.
// Aucune dépendance. Suppose que ton backend expose /me et /logout.
// Optionnel: /account/discord/unlink, /account/password, /account/delete, /sessions/* (si tu les ajoutes plus tard).

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { res, data };
}

function $(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text ?? "";
}

function setDiscordStatus(verified) {
  // Tu peux adapter les labels selon ton UI
  setText("discord-status", verified ? "Connected ✅" : "Not linked");
}

async function loadAccountInfo() {
  const { res, data } = await api("/me", { method: "GET" });

  if (!res.ok || !data.ok) {
    // Pas connecté -> tu peux fermer l'overlay, rediriger, etc.
    setText("user-username", "—");
    setText("user-phantomid", "—");
    setText("discord-status", "Not logged in");
    console.warn("Not logged in or /me failed:", data);
    return;
  }

  const u = data.user || {};
  setText("user-username", u.username || "(no username)");
  setText("user-phantomid", u.phantomId || "—");
  setDiscordStatus(!!u.verifiedDiscord);
}

// -------- Actions (liées à des éléments existants) --------

// 1) Verify Account (dans ton HTML c'est un <a> sans href)
function wireVerifyAccount() {
  const verifyEl = document.querySelector(".verify-account-box");
  if (!verifyEl) return;

  verifyEl.addEventListener("click", () => {
    // Pour l’instant, “Verify Account” = relier Discord (OAuth)
    // Comme c’est un overlay, tu peux aussi window.open si tu préfères.
    window.location.href = "/auth/discord";
  });
}

// 2) Change Password (placeholder — ouvre un modal plus tard)
function wireChangePassword() {
  const btn = document.querySelector(".change-password-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    // Pour l’instant: simple placeholder (tu peux remplacer par overlay modal)
    alert("Change Password: à brancher sur un modal + endpoint /account/password.");
  });
}

// 3) Log out (tu as 1 <a> “Log Out” dans Active Sessions — on la map à /logout)
function wireLogoutButtons() {
  const sessionLinks = document.querySelectorAll(".active-sessions a");
  if (!sessionLinks || sessionLinks.length === 0) return;

  // Hypothèse: le 1er <a> = Log Out (session courante)
  const logoutCurrent = sessionLinks[0];
  logoutCurrent.addEventListener("click", async (e) => {
    e.preventDefault();
    const { res, data } = await api("/logout", { method: "POST" });
    if (!res.ok || !data.ok) {
      alert(data.error || "Logout failed");
      return;
    }
    // Tu peux fermer overlay ici si tu as un handler
    window.location.href = "/index.html?logout=ok";
  });

  // Hypothèse: le 2e <a> = Log Out Session (autre session) — pas dispo avec express-session default
  const logoutOther = sessionLinks[1];
  if (logoutOther) {
    logoutOther.addEventListener("click", (e) => {
      e.preventDefault();
      alert(
        "Log Out Session: nécessite un système 'sessions' (liste + revoke) côté backend."
      );
    });
  }
}

// 4) Log out all other sessions (placeholder)
function wireLogoutAllOtherSessions() {
  const btn = document.querySelector(".danger-zone a"); // 1er lien dans danger zone
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    alert(
      "Sign Out All Other Sessions: nécessite un endpoint backend (ex: /sessions/revoke-others)."
    );
  });
}

// 5) Delete Account (placeholder avec confirmation)
function wireDeleteAccount() {
  const btn = document.querySelector(".delete-account-btn");
  if (!btn) return;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const ok = confirm(
      "Supprimer ton compte PhantomID ? Cette action est irréversible."
    );
    if (!ok) return;

    alert(
      "Delete Account: à brancher sur un endpoint backend (ex: POST /account/delete)."
    );
  });
}

// -------- Init --------
document.addEventListener("DOMContentLoaded", async () => {
  await loadAccountInfo();

  wireVerifyAccount();
  wireChangePassword();
  wireLogoutButtons();
  wireLogoutAllOtherSessions();
  wireDeleteAccount();
});
