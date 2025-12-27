console.log("login.js connecté");

document.addEventListener("DOMContentLoaded", () => {
  const loginOverlay = document.getElementById("login-overlay");
  const closeBtn = document.getElementById("close-login-overlay");
  const form = document.getElementById("login-form");

  const emailInput = document.getElementById("login-email");
  const passInput = document.getElementById("login-confirm-password");

  // Bouton navbar "Log in" (si tu en as un)
  const openBtn = document.getElementById("open-login-overlay");

  function openLogin() {
    if (!loginOverlay) return;
    loginOverlay.classList.add("active");
  }

  function closeLogin() {
    if (!loginOverlay) return;
    loginOverlay.classList.remove("active");
  }

  // Expose pour ouvrir le login via query param (?login=required)
  window.openLoginOverlay = openLogin;

  if (openBtn) {
    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openLogin();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeLogin();
    });
  }

  // clic en dehors du box = close (optionnel)
  if (loginOverlay) {
    loginOverlay.addEventListener("click", (e) => {
      if (e.target === loginOverlay) closeLogin();
    });
  }

  // ✅ Ouvrir automatiquement l’overlay si redirect ?login=required
  const params = new URLSearchParams(window.location.search);
  if (params.get("login") === "required") {
    openLogin();
  }

  if (!form) {
    console.warn("login-form introuvable (id=login-form)");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (emailInput?.value || "").trim();
    const password = (passInput?.value || "").trim();

    if (!email || !password) {
      alert("Please fill all fields.");
      return;
    }

    try {
      const resp = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.ok) {
        alert(data.error || "Login failed");
        return;
      }

      // ✅ ferme l'overlay et redirect (route protégée)
      closeLogin();
      window.location.href = data.redirectTo || "/phantomcard";
    } catch (err) {
      console.error(err);
      alert("Server error. Check terminal.");
    }
  });
});
