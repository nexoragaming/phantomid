console.log("navbar.js connecté");

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
    const resp = await fetch("/me", { method: "GET" });
    const data = await resp.json().catch(() => ({}));

    if (data.ok) {
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
        await fetch("/logout", { method: "POST" });
      } catch (err) {
        console.error("Logout error:", err);
      }

      // UI + reload landing clean
      showGuest();
      window.location.href = "/index.html";
    });
  }
});
