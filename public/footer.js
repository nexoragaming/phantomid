console.log("JS chargé");
//Overlay

//Login
const openLoginBtn = document.getElementById("footer-open-login");
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
const openCreateAccountBtn = document.getElementById("footer-open-create-account");
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