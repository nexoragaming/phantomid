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



//Overlay

//Login
const openLoginBtn = document.getElementById("open-login-overlay");
const loginOverlay = document.getElementById("login-overlay");

openLoginBtn.addEventListener("click", function () {
  loginOverlay.classList.add("active");
});

const closeLoginBtn = document.getElementById("close-login-overlay");
    closeLoginBtn.addEventListener("click", function () {
        loginOverlay.classList.remove("active");
    });

const noAccountBtn = document.getElementById("no-account-btn");

noAccountBtn.addEventListener("click", function () {
    loginOverlay.classList.remove("active");
    createAccountOverlay.classList.add("active");
});

document.addEventListener("keydown", function (event) {
  console.log(event.key);
  if (event.key === "Escape") {
  loginOverlay.classList.remove("active")
}
});

loginOverlay.addEventListener("click", function () {
    loginOverlay.classList.remove("active")
});

const loginFormBox = document.getElementById("login-form-box");

loginFormBox.addEventListener("click", function (event){
    event.stopPropagation("login-form-box")
})

//Create Account
const openCreateAccountBtn = document.getElementById("open-create-account-overlay");
const createAccountOverlay = document.getElementById("create-account-overlay");
openCreateAccountBtn.addEventListener("click", function () {
  createAccountOverlay.classList.add("active");
});

const closeCreateAccountOverlay = document.getElementById("close-create-account-overlay-btn");
    closeCreateAccountOverlay.addEventListener("click", function () {
        createAccountOverlay.classList.remove("active");
    });

const alreadyAccountBtn = document.getElementById("already-account-btn");

alreadyAccountBtn.addEventListener("click", function () {
  createAccountOverlay.classList.remove("active");
   loginOverlay.classList.add("active");
});


document.addEventListener("keydown", function (event) {
  console.log(event.key);
  if (event.key === "Escape") {
  createAccountOverlay.classList.remove("active")
}
});


createAccountOverlay.addEventListener("click", function () {
    createAccountOverlay.classList.remove("active")
});

const createAccountBox = document.getElementById("create-account-box");

createAccountBox.addEventListener("click", function (event){
    event.stopPropagation("create-account-box")
})