console.log("navbar.js connecté");

// ⚠️ Anti-flash IMMEDIAT : on cache les 2 navbars dès le chargement du script
const navGuestEarly = document.getElementById("nav-guest");
const navUserEarly = document.getElementById("nav-user");

if (navGuestEarly) navGuestEarly.style.display = "none";
if (navUserEarly) navUserEarly.style.display = "none";

document.addEventListener("DOMContentLoaded", async () => {
  const navGuest = document.getElementById("nav-guest");
  const navUser = document.getElementById("nav-user");
  const logoutBtn = document.getElementById("nav-logout");

  function showGuest() {
    if (navGuest) navGuest.style.display = "";
    if (navUser) navUser.style.display = "none";
  }

  function showUser() {
    if (navGuest) navGuest.style.display = "none";
    if (navUser) navUser.style.display = "";
  }

  // 1) Check session
  try {
    const resp = await fetch("/me", { method: "GET", credentials: "include" });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data?.ok) {
      showUser();
    } else {
      showGuest();
    }
  } catch (e) {
    console.error("Navbar /me error:", e);
    showGuest();
  }

  // 2) Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      try {
        await fetch("/logout", { method: "POST", credentials: "include" });
      } catch (err) {
        console.error("Logout error:", err);
      }

      showGuest();
      window.location.href = "/";
    });
  }
});

//Nav hamburger
document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector(".nav-user") || document.querySelector(".nav-guest");
  if (!nav) return;

  // évite d’en créer 2 si tu reload/append
  if (!nav.querySelector(".nav-toggle")) {
    const btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Open menu");
    btn.innerHTML = "<span>☰</span>";
    nav.appendChild(btn);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      nav.classList.toggle("nav-open");
      btn.innerHTML = nav.classList.contains("nav-open")
        ? "<span>✕</span>"
        : "<span>☰</span>";
    });

    // optionnel: clic dehors ferme
    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) {
        nav.classList.remove("nav-open");
        btn.innerHTML = "<span>☰</span>";
      }
    });
  }
});
