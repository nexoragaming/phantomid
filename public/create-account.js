console.log("✅ create-account.js chargé");

document.addEventListener("DOMContentLoaded", () => {
  const createOverlay = document.getElementById("create-account-overlay");
  const linkingOverlay = document.getElementById("linking-overlay");
  const form = document.querySelector("form.create-account-form");

  console.log("form:", !!form);
  console.log("createOverlay:", !!createOverlay);
  console.log("linkingOverlay:", !!linkingOverlay);

  console.log("dup check:", {
    phantom_id: document.querySelectorAll("#phantom_id").length,
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

    // ✅ Lire DANS le form
    const phantomIdEl = form.querySelector("#phantom_id");
    const usernameEl = form.querySelector("#username");
    const emailEl = form.querySelector("#email");
    const passwordEl = form.querySelector("#password");
    const confirmEl = form.querySelector("#confirm-password");

    const phantomId = (phantomIdEl?.value || "").trim().toUpperCase();
    const username = (usernameEl?.value || "").trim();
    const email = (emailEl?.value || "").trim();
    const password = passwordEl?.value || "";
    const confirmPassword = confirmEl?.value || "";

    console.log("SUBMIT values:", {
      phantomId,
      username,
      email,
      passwordLen: password.length,
      confirmLen: confirmPassword.length,
    });

    if (!phantomId || !username || !email || !password || !confirmPassword) {
      alert("Please fill all fields.");
      return;
    }

    if (!/^PH\\d{6}$/i.test(phantomId)) {
      alert("Invalid PhantomID format. Example: PH000001");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    // 1) pending signup + phantomId
    const resp = await fetch("/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phantomId, username, email, password }),
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

    if (!resp.ok || !data.ok) {
      alert(data.error || "Signup error");
      return;
    }

    // 2) Ouvre linking overlay
    if (createOverlay) createOverlay.classList.remove("active");
    if (linkingOverlay) linkingOverlay.classList.add("active");

    console.log("✅ linking overlay ouvert → lancement OAuth");

    // 3) Lance OAuth Discord
    window.location.href = "https://phantomid.onrender.com/auth/discord";
  });
});
