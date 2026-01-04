console.log("navbar.js connecté");

/* ======================================================
   ANTI-FLASH IMMÉDIAT (desktop)
====================================================== */
const navGuestEarly = document.getElementById("nav-guest");
const navUserEarly = document.getElementById("nav-user");

if (navGuestEarly) navGuestEarly.style.display = "none";
if (navUserEarly) navUserEarly.style.display = "none";

/* ======================================================
   DOM READY
====================================================== */
document.addEventListener("DOMContentLoaded", async () => {

  /* ---------- DESKTOP ---------- */
  const navGuest = document.getElementById("nav-guest");
  const navUser = document.getElementById("nav-user");
  const logoutBtn = document.getElementById("nav-logout");

  /* ---------- MOBILE ---------- */
  const mobileTopnav = document.getElementById("mobileTopnav");
  const mobileGuest = document.getElementById("mobileGuestLinks");
  const mobileUser = document.getElementById("mobileUserLinks");
  const hamburger = document.getElementById("mobileHamburger");

  let activeMobileMenu = null;

  /* ---------- Helpers ---------- */
  function showGuest() {
    // Desktop
    if (navGuest) navGuest.style.display = "";
    if (navUser) navUser.style.display = "none";

    // Mobile
    if (mobileGuest) mobileGuest.style.display = "none";
    if (mobileUser) mobileUser.style.display = "none";
    activeMobileMenu = mobileGuest;
  }

  function showUser() {
    // Desktop
    if (navGuest) navGuest.style.display = "none";
    if (navUser) navUser.style.display = "";

    // Mobile
    if (mobileGuest) mobileGuest.style.display = "none";
    if (mobileUser) mobileUser.style.display = "none";
    activeMobileMenu = mobileUser;
  }

  function closeMobileMenu() {
    if (activeMobileMenu) activeMobileMenu.style.display = "none";
    hamburger?.setAttribute("aria-expanded", "false");
  }

  function toggleMobileMenu() {
    if (!activeMobileMenu) return;
    const isOpen = activeMobileMenu.style.display === "block";
    activeMobileMenu.style.display = isOpen ? "none" : "block";
    hamburger?.setAttribute("aria-expanded", String(!isOpen));
  }

  /* ======================================================
     1️⃣ CHECK SESSION (/me)
  ====================================================== */
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

  /* ======================================================
     2️⃣ LOGOUT (desktop + mobile)
  ====================================================== */
  document.querySelectorAll("#nav-logout").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      try {
        await fetch("/logout", { method: "POST", credentials: "include" });
      } catch (err) {
        console.error("Logout error:", err);
      }

      showGuest();
      window.location.href = "/";
    });
  });

  /* ======================================================
     3️⃣ MOBILE HAMBURGER
  ====================================================== */
  if (hamburger) {
    hamburger.addEventListener("click", (e) => {
      e.preventDefault();
      toggleMobileMenu();
    });
  }

  // Ferme au clic sur un lien
  if (mobileTopnav) {
    mobileTopnav.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a && a.getAttribute("href")) {
        closeMobileMenu();
      }
    });
  }

  // Ferme si clic extérieur
  document.addEventListener("click", (e) => {
    if (mobileTopnav && !mobileTopnav.contains(e.target)) {
      closeMobileMenu();
    }
  });

  // Reset si on repasse desktop
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1024) {
      closeMobileMenu();
    }
  });

  /* ======================================================
     API PUBLIQUE (si login via overlay)
  ====================================================== */
  window.navbarSetLoggedIn = (isLoggedIn) => {
    isLoggedIn ? showUser() : showGuest();
  };
});
