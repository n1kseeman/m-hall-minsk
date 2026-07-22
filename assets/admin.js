(() => {
  const storageKey = "mhall.admin.session";
  const defaultEndpoint = "https://m-hall-booking.n1kseeman-rh.workers.dev";
  const loginPanel = document.querySelector("[data-login-panel]");
  const loginForm = document.querySelector("[data-login-form]");
  const app = document.querySelector("[data-admin-app]");
  const editor = document.querySelector("[data-halls-editor]");
  const status = document.querySelector("[data-admin-status]");
  const template = document.querySelector("#hall-template");
  let session = JSON.parse(sessionStorage.getItem(storageKey) || "null");
  let halls = [];

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `admin-status ${type}`.trim();
  }

  function endpoint(path) {
    return `${session.endpoint.replace(/\/$/, "")}${path}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(endpoint(path), {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${session.token}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function slug(value) {
    return String(value || "hall")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-+|-+$/g, "") || `hall-${Date.now()}`;
  }

  function normalizeHall(hall = {}) {
    const images = Array.isArray(hall.images) ? hall.images : (hall.image ? [hall.image] : []);
    return { id: hall.id || slug(hall.title), title: hall.title || "Новый зал", tagline: hall.tagline || "M HALL", description: hall.description || "", images };
  }

  function renderPhotos(container, hall, index) {
    container.replaceChildren(...hall.images.map((src, photoIndex) => {
      const item = document.createElement("div");
      item.className = "admin-photo";
      const preview = typeof src === "string" ? src : src.dataUrl;
      const value = typeof src === "string" ? src : src.name;
      item.innerHTML = `<img src="${preview}" alt=""><input value="${value}" ${typeof src === "string" ? "" : "readonly"}><div><button type="button">←</button><button type="button">→</button><button type="button">×</button></div>`;
      const input = item.querySelector("input");
      const [left, right, del] = item.querySelectorAll("button");
      if (typeof src === "string") input.addEventListener("input", () => { hall.images[photoIndex] = input.value.trim(); });
      left.addEventListener("click", () => { if (photoIndex > 0) [hall.images[photoIndex - 1], hall.images[photoIndex]] = [hall.images[photoIndex], hall.images[photoIndex - 1]]; render(); });
      right.addEventListener("click", () => { if (photoIndex < hall.images.length - 1) [hall.images[photoIndex + 1], hall.images[photoIndex]] = [hall.images[photoIndex], hall.images[photoIndex + 1]]; render(); });
      del.addEventListener("click", () => { hall.images.splice(photoIndex, 1); render(); });
      return item;
    }));
  }

  function render() {
    editor.replaceChildren(...halls.map((hall, index) => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.querySelectorAll("[data-field]").forEach((input) => {
        input.value = hall[input.dataset.field] || "";
        input.addEventListener("input", () => { hall[input.dataset.field] = input.value.trim(); });
      });
      node.querySelector("[data-move-up]").disabled = index === 0;
      node.querySelector("[data-move-down]").disabled = index === halls.length - 1;
      node.querySelector("[data-move-up]").addEventListener("click", () => { [halls[index - 1], halls[index]] = [halls[index], halls[index - 1]]; render(); });
      node.querySelector("[data-move-down]").addEventListener("click", () => { [halls[index + 1], halls[index]] = [halls[index], halls[index + 1]]; render(); });
      node.querySelector("[data-delete-hall]").addEventListener("click", () => { if (confirm(`Удалить «${hall.title}»?`)) { halls.splice(index, 1); render(); } });
      node.querySelector("[data-add-photo-url]").addEventListener("click", () => { const src = prompt("URL фотографии"); if (src) { hall.images.push(src.trim()); render(); } });
      node.querySelector("[data-upload-photo]").addEventListener("change", async (event) => {
        const file = event.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { hall.images.push({ name: file.name, type: file.type, dataUrl: reader.result }); render(); };
        reader.readAsDataURL(file);
      });
      renderPhotos(node.querySelector("[data-photos]"), hall, index);
      return node;
    }));
  }

  async function load() {
    setStatus("Загружаем данные...");
    const data = await api("/admin/halls");
    halls = (data.halls || []).map(normalizeHall);
    render();
    setStatus("Данные загружены.", "is-success");
  }

  async function save() {
    setStatus("Сохраняем изменения в GitHub...");
    const payload = { halls: halls.map((hall) => ({ ...hall, id: hall.id || slug(hall.title), image: hall.images[0] || "" })) };
    await api("/admin/halls", { method: "PUT", body: JSON.stringify(payload) });
    setStatus("Изменения сохранены в GitHub.", "is-success");
    await load();
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(loginForm);
    session = { endpoint: form.get("endpoint") || defaultEndpoint, token: "" };
    const response = await fetch(endpoint("/admin/login"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ password: form.get("password") }) });
    const data = await response.json();
    if (!response.ok || !data.token) { alert(data.error || "Не удалось войти"); return; }
    session.token = data.token;
    sessionStorage.setItem(storageKey, JSON.stringify(session));
    boot();
  }

  function boot() {
    loginPanel.hidden = Boolean(session?.token);
    app.hidden = !session?.token;
    if (session?.token) load().catch((error) => setStatus(error.message, "is-error"));
  }

  loginForm.endpoint.value = session?.endpoint || defaultEndpoint;
  loginForm.addEventListener("submit", login);
  document.querySelector("[data-add-hall]").addEventListener("click", () => { halls.push(normalizeHall()); render(); });
  document.querySelector("[data-reload]").addEventListener("click", () => load().catch((error) => setStatus(error.message, "is-error")));
  document.querySelector("[data-save]").addEventListener("click", () => save().catch((error) => setStatus(error.message, "is-error")));
  document.querySelector("[data-logout]").addEventListener("click", () => { sessionStorage.removeItem(storageKey); session = null; boot(); });
  boot();
})();
