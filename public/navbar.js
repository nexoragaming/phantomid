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

  // ✅ AJOUT: références mobile (tes IDs actuels)
  const mobileUser = document.getElementById("user-link");
  const mobileGuest = document.getElementById("guest-link");

  function showGuest() {
    if (navGuest) navGuest.style.display = "";
    if (navUser) navUser.style.display = "none";

    // ✅ AJOUT: mobile
    if (mobileGuest) mobileGuest.style.display = "";
    if (mobileUser) mobileUser.style.display = "none";
  }

  function showUser() {
    if (navGuest) navGuest.style.display = "none";
    if (navUser) navUser.style.display = "";

    // ✅ AJOUT: mobile
    if (mobileGuest) mobileGuest.style.display = "none";
    if (mobileUser) mobileUser.style.display = "";
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


function myFunction() {
  var x = document.getElementById("Links");
  if (x.style.display === "block") {
    x.style.display = "none";
  } else {
    x.style.display = "block";
  }
}
