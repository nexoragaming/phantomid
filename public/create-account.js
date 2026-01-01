console.log("✅ create-account.js chargé");

document.addEventListener("DOMContentLoaded", () => {
  const createOverlay = document.getElementById("create-account-overlay");
  const linkingOverlay = document.getElementById("linking-overlay");
  const form = document.querySelector("form.create-account-form");

  // 🔽 Country UI
  const countrySelect = document.getElementById("country-selector"); // ⚠️ ajuste si ton select a un autre id
  const flagImg = document.getElementById("flags"); // ✅ tu as dit id="flags"

  console.log("form:", !!form);
  console.log("createOverlay:", !!createOverlay);
  console.log("linkingOverlay:", !!linkingOverlay);
  console.log("countrySelect:", !!countrySelect);
  console.log("flagImg:", !!flagImg);

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

  // =====================================================
  // Countries loader + flag update
  // =====================================================
  function flagUrlFromCode(code) {
    const c = String(code || "").trim().toLowerCase();
    if (!c || c.length !== 2) return "";
    return `https://flagcdn.com/w80/${c}.png`;
  }

  function setFlagByCode(code) {
    if (!flagImg) return;
    const url = flagUrlFromCode(code);
    if (!url) {
      // fallback (optionnel)
      flagImg.removeAttribute("src");
      flagImg.alt = "No flag";
      return;
    }
    flagImg.src = url;
    flagImg.alt = `Flag ${String(code || "").toUpperCase()}`;
  }

  async function loadCountriesIntoSelect() {
    if (!countrySelect) return;

    // Option placeholder
    countrySelect.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select a country";
    countrySelect.appendChild(opt0);

    try {
      const resp = await fetch("/api/countries", { method: "GET" });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.ok || !Array.isArray(data.countries)) {
        console.error("❌ /api/countries error:", data);
        // On laisse juste le placeholder si ça fail
        return;
      }

      for (const c of data.countries) {
        const code = String(c.code || "").toUpperCase();
        const name = String(c.name || "").trim();
        if (!code || !name) continue;

        const opt = document.createElement("option");
        opt.value = code; // ex: "CA"
        opt.textContent = name; // ex: "Canada"
        countrySelect.appendChild(opt);
      }

      // Default: si rien choisi, on peut mettre un défaut (optionnel)
      // Ex: Canada
      if (!countrySelect.value) {
        const defaultCode = "CA";
        const hasDefault = [...countrySelect.options].some((o) => o.value === defaultCode);
        if (hasDefault) countrySelect.value = defaultCode;
      }

      // Apply flag initial
      setFlagByCode(countrySelect.value);

      // Update flag on change
      countrySelect.addEventListener("change", () => {
        setFlagByCode(countrySelect.value);
      });
    } catch (e) {
      console.error("❌ loadCountriesIntoSelect failed:", e);
    }
  }

  // Lance le load au chargement
  loadCountriesIntoSelect();

  // =====================================================
  // Submit
  // =====================================================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const usernameEl = form.querySelector("#username");
    const emailEl = form.querySelector("#email");
    const passwordEl = form.querySelector("#password");
    const confirmEl = form.querySelector("#confirm-password");

    const username = (usernameEl?.value || "").trim();
    const email = (emailEl?.value || "").trim();
    const password = passwordEl?.value || "";
    const confirmPassword = confirmEl?.value || "";

    const country = String(countrySelect?.value || "").trim().toUpperCase(); // ex: "CA"

    if (!username || !email || !password || !confirmPassword) {
      alert("Please fill all fields.");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    if (!country) {
      alert("Please select a country.");
      return;
    }

    // 1) pending signup (serveur génère PHxxxxxx)
    const resp = await fetch("/signup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, country }), // ✅ country envoyé
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

    // 3) OAuth Discord
    window.location.href = "https://phantomid.onrender.com/auth/discord";
  });
});
