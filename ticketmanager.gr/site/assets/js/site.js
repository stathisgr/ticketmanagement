/* ticketmanager.gr — shared site JS (nav toggle + lead form) */
(function () {
  "use strict";
  var SUPA = "https://jyxcqenkguokveyfsvvs.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5eGNxZW5rZ3Vva3ZleWZzdnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0Nzk0MjcsImV4cCI6MjA5NjA1NTQyN30.McYDzilz2h0FuOAb-xV8g-vvBTuHe5CFnsYggVLS3is";

  /* Mobile nav */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-nav-toggle]");
    if (t) { document.querySelector(".nav-links")?.classList.toggle("open"); return; }
    if (e.target.closest(".nav-links a")) document.querySelector(".nav-links")?.classList.remove("open");
  });

  /* Lead form */
  var form = document.getElementById("lead-form");
  if (!form) return;
  var msg = document.getElementById("form-msg");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var body = {};
    fd.forEach(function (v, k) { body[k] = v; });
    body.lang = document.documentElement.lang || "el";
    body.source = location.href;
    var btn = form.querySelector("button[type=submit]");
    if (btn) { btn.disabled = true; }
    try {
      var r = await fetch(SUPA + "/functions/v1/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + ANON },
        body: JSON.stringify(body),
      });
      var j = await r.json();
      if (r.ok && j.ok) {
        msg.className = "form-msg ok"; msg.textContent = form.getAttribute("data-ok") || "✓ Ευχαριστούμε! Λάβαμε το αίτημά σας.";
        form.reset();
      } else {
        msg.className = "form-msg err"; msg.textContent = (form.getAttribute("data-err") || "Σφάλμα: ") + (j.error || r.status);
      }
    } catch (err) {
      msg.className = "form-msg err"; msg.textContent = (form.getAttribute("data-err") || "Σφάλμα: ") + err;
    } finally { if (btn) btn.disabled = false; }
  });
})();
