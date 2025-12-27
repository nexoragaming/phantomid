console.log("✅ create-account.js chargé");

document.addEventListener("DOMContentLoaded", () => {
  const createOverlay = document.getElementById("create-account-overlay");
  const linkingOverlay = document.getElementById("linking-overlay");
  const form = document.querySelector("form.create-account-form");

  console.log("form:", !!form);
  console.log("createOverlay:", !!createOverlay);
  console.log("linkingOverlay:", !!linkingOverlay);

  // Debug: détecter IDs dupliqués (super important)
  console.log("dup check:", {
    username: document.querySelectorAll("#username").length,
    email: document.querySelectorAll("#email").length,
    password: document.querySelectorAll("#password").length,
    confirm: document.querySelectorAll("#confirm-password").length,
  });

  if (!form) {
    alert("❌ Form introuvable (.create-account-form)");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // ✅ Lire DANS le form (évite les mauvais éléments si IDs dupliqués)
    const usernameEl = form.querySelector("#username");
    const emailEl = form.querySelector("#email");
    const passwordEl = form.querySelector("#password");
    const confirmEl = form.querySelector("#confirm-password");

    const username = (usernameEl?.value || "").trim();
    const email = (emailEl?.value || "").trim();
    const password = passwordEl?.value || "";
    const confirmPassword = confirmEl?.value || "";

    console.log("SUBMIT values:", {
      username,
      email,
      passwordLen: password.length,
      confirmLen: confirmPassword.length,
    });

    if (!username || !email || !password || !confirmPassword) {
      alert("Please fill all fields.");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    // 1) pending signup
    const resp = await fetch("/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });

    let data;
    try {
      data = await resp.json();
    } catch {
      const t = await resp.text();
      console.error("signup/start non-JSON:", t);
      alert("Server error (check terminal).");
      return;
    }

    if (!data.ok) {
      alert(data.error || "Signup error");
      return;
    }

    // 2) Ouvre linking overlay
    if (createOverlay) createOverlay.classList.remove("active");
    if (linkingOverlay) linkingOverlay.classList.add("active");

    console.log("✅ linking overlay ouvert");
  });
});
