(() => {
  const body = document.body;
  const header = document.querySelector("[data-header]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const nav = document.querySelector("[data-nav]");
  const form = document.querySelector("[data-booking-form]");
  const status = document.querySelector("[data-form-status]");
  const submitButton = document.querySelector("[data-submit-button]");
  const dateInput = document.querySelector("[data-event-date]");
  const lightbox = document.querySelector("[data-lightbox]");
  const lightboxImage = document.querySelector("[data-lightbox-image]");
  const lightboxCaption = document.querySelector("[data-lightbox-caption]");
  const lightboxClose = document.querySelector("[data-lightbox-close]");

  function setHeaderState() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  }

  function closeMenu() {
    if (!menuToggle || !nav) return;
    body.classList.remove("menu-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Открыть меню");
  }

  function setMinDate() {
    if (!dateInput) return;
    const today = new Date();
    const timezoneOffset = today.getTimezoneOffset() * 60000;
    dateInput.min = new Date(today.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form || !status || !submitButton) return;

    const endpoint = (form.dataset.formEndpoint || "").trim();
    submitButton.disabled = true;
    status.className = "form-status";
    status.textContent = "Готовим заявку...";

    if (!endpoint) {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      status.classList.add("is-warning");
      status.textContent = "Заявка не ушла автоматически. Напишите нам в Инстаграм - ответим по свободным датам.";
      submitButton.disabled = false;
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      form.reset();
      status.classList.add("is-success");
      status.textContent = "Заявка отправлена. Мы скоро свяжемся с вами.";
    } catch (error) {
      console.error(error);
      status.classList.add("is-error");
      status.textContent = "Не получилось отправить заявку. Напишите нам в Инстаграм - проверим дату вручную.";
    } finally {
      submitButton.disabled = false;
    }
  }

  function openLightbox(button) {
    if (!lightbox || !lightboxImage || !lightboxCaption) return;
    const full = button.dataset.full || button.querySelector("img")?.src;
    const image = button.querySelector("img");
    lightboxImage.src = full || "";
    lightboxImage.alt = image?.alt || "M HALL";
    lightboxCaption.textContent = button.getAttribute("aria-label") || image?.alt || "";
    lightbox.setAttribute("aria-hidden", "false");
    body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    if (!lightbox || !lightboxImage) return;
    lightbox.setAttribute("aria-hidden", "true");
    body.classList.remove("lightbox-open");
    lightboxImage.src = "";
  }

  function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!items.length || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15 });

    items.forEach((item) => observer.observe(item));
  }

  setHeaderState();
  setMinDate();
  initReveal();

  window.addEventListener("scroll", setHeaderState, { passive: true });

  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const isOpen = body.classList.toggle("menu-open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
    });
  }

  if (nav) {
    nav.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) closeMenu();
    });
  }

  if (form) form.addEventListener("submit", handleSubmit);

  document.querySelectorAll("[data-full]").forEach((button) => {
    button.addEventListener("click", () => openLightbox(button));
  });

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightbox) {
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      closeLightbox();
    }
  });
})();
