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
// ===== Mobile / Tablet hamburger (<=1024px) =====
(() => {
  const nav = document.getElementById("nav-user") || document.getElementById("nav-guest");
  if (!nav) return;

  // évite doublon si navbar.js est chargé 2 fois
  if (nav.querySelector(".nav-toggle")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-toggle";
  btn.setAttribute("aria-label", "Open menu");
  btn.innerHTML = "<span>☰</span>";

  nav.appendChild(btn);

  const closeMenu = () => nav.classList.remove("nav-open");

  btn.addEventListener("click", () => {
    nav.classList.toggle("nav-open");
  });

  // ferme le menu quand on clique un lien
  nav.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", closeMenu);
  });

  // si on repasse en desktop, on ferme
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1024) closeMenu();
  });
})();
