console.log("login.js connecté");

document.addEventListener("DOMContentLoaded", () => {
  const loginOverlay = document.getElementById("login-overlay");
  const closeBtn = document.getElementById("close-login-overlay");
  const form = document.getElementById("login-form");

  if (!form) {
    console.warn("login-form introuvable");
    return;
  }

  // 🔐 Champs UNIQUEMENT dans le form login
  const emailInput = form.querySelector('input[name="email"]');
  const passInput  = form.querySelector('input[name="password"]');

  function openLogin() {
    loginOverlay?.classList.add("active");
  }

  function closeLogin() {
    loginOverlay?.classList.remove("active");
  }

  window.openLoginOverlay = openLogin;

  document.getElementById("open-login-overlay")?.addEventListener("click", (e) => {
    e.preventDefault();
    openLogin();
  });

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeLogin();
  });

  loginOverlay?.addEventListener("click", (e) => {
    if (e.target === loginOverlay) closeLogin();
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("login") === "required") openLogin();

  // ✅ SUBMIT LOGIN
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput?.value.trim();
    const password = passInput?.value.trim();

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

      closeLogin();
      window.location.href = data.redirectTo || "/phantomcard.html";
    } catch (err) {
      console.error(err);
      alert("Server error.");
    }
  });
});
