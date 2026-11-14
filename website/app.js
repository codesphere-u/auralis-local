(function () {
  function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.setTimeout(() => el.classList.remove("show"), 2200);
  }

  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      const open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard");
      } catch (err) {
        showToast("Copy failed: " + (err && err.message ? err.message : "clipboard unavailable"));
      }
    });
  });

  const profileEl = document.getElementById("studio-profile");
  const modelEl = document.getElementById("studio-model");
  const ragEl = document.getElementById("studio-rag");
  const runBtn = document.getElementById("studio-run");

  function evaluateAuralis() {
    if (!profileEl || !modelEl || !ragEl) return;
    const profile = profileEl.value;
    const model = modelEl.value;
    const useKnowledge = ragEl.value === "on";
    const ctxTokens = profile === "fast" ? 2048 : 4096;
    const kvMiB = profile === "fast" ? 185 : 370;

    const outEl = document.getElementById("studio-output");
    if (outEl) {
      outEl.textContent = JSON.stringify({
        model,
        weight_guard_max_gib: 8,
        cloud_alias_blocked: true,
        context_profile: profile,
        num_ctx: ctxTokens,
        estimated_kv_cache_mib: kvMiB,
        useKnowledge,
        retrieval_mode: useKnowledge ? "BM25 + exact-phrase + #Lstart-Lend citations" : "disabled",
        loopback_bind: "127.0.0.1:4317"
      }, null, 2);
    }
  }

  if (runBtn) {
    runBtn.addEventListener("click", evaluateAuralis);
    [profileEl, modelEl, ragEl].forEach((el) => {
      if (el) el.addEventListener("change", evaluateAuralis);
    });
    evaluateAuralis();
  }
})();
