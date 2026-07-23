(() => {
  const config = window.M_HALL_ADMIN_CONFIG || {};
  const apiUrl = String(config.apiUrl || "").replace(/\/+$/, "");
  const siteRoot = new URL("../", window.location.href);
  const contentUrl = new URL("content/halls.json", siteRoot);
  const placeholderImage = "assets/photos/mhall-01.webp";
  const sessionKey = "mhall-admin-session";
  const maxImagesPerHall = 10;

  const loginViews = document.querySelectorAll("[data-login-view]");
  const editorViews = document.querySelectorAll("[data-editor-view]");
  const loginForm = document.querySelector("[data-login-form]");
  const loginButton = document.querySelector("[data-login-button]");
  const loginStatus = document.querySelector("[data-login-status]");
  const editorStatus = document.querySelector("[data-editor-status]");
  const hallsList = document.querySelector("[data-halls-list]");
  const addHallButton = document.querySelector("[data-add-hall]");
  const saveButton = document.querySelector("[data-save]");
  const logoutButton = document.querySelector("[data-logout]");

  const state = {
    halls: [],
    originalImages: new Set(),
    token: sessionStorage.getItem(sessionKey) || "",
    isSaving: false
  };

  function setStatus(element, message = "", type = "") {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function show(elements, visible) {
    elements.forEach((element) => { element.hidden = !visible; });
  }

  function isManagedImage(path) {
    return typeof path === "string" && path.startsWith("assets/photos/");
  }

  function resolveImageUrl(path) {
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    return new URL(path, siteRoot).href;
  }

  function createHallId() {
    const suffix = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `hall-${suffix}`;
  }

  function makePhoto(path, previewUrl = "", upload = null) {
    return { path, previewUrl, upload };
  }

  function normalizeImages(hall) {
    const candidate = Array.isArray(hall.images) ? hall.images : [hall.image];
    return candidate
      .filter((image) => typeof image === "string" && image.trim() && image !== placeholderImage)
      .map((image) => makePhoto(image));
  }

  function getHallImagePaths(hall) {
    return hall.images.map((photo) => photo.path);
  }

  function markChanged() {
    setStatus(editorStatus, "Есть несохранённые изменения.");
  }

  async function request(path, options = {}) {
    if (!apiUrl) throw new Error("Сервис публикации ещё не подключён.");
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const error = new Error(payload.error || "Не удалось выполнить запрос.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadHalls() {
    const url = new URL(contentUrl);
    url.searchParams.set("v", Date.now().toString());
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить список залов.");
    const content = await response.json();
    if (!Array.isArray(content.halls)) throw new Error("Некорректный формат списка залов.");
    state.halls = content.halls.map((hall) => ({
      id: String(hall.id || createHallId()),
      title: String(hall.title || ""),
      description: String(hall.description || ""),
      tagline: String(hall.tagline || "банкетное пространство"),
      images: normalizeImages(hall)
    }));
    state.originalImages = new Set(state.halls.flatMap(getHallImagePaths).filter(isManagedImage));
    renderHalls();
  }

  function makeIconButton(symbol, label, className = "") {
    const button = document.createElement("button");
    button.className = `icon-button ${className}`.trim();
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  }

  function createPhotoTile(hall, photo, index) {
    const tile = document.createElement("figure");
    const image = document.createElement("img");
    const caption = document.createElement("figcaption");
    const mainBadge = document.createElement("span");
    const controls = document.createElement("div");
    const mainButton = makeIconButton("★", "Сделать главной фотографией");
    const leftButton = makeIconButton("←", "Переместить фотографию влево");
    const rightButton = makeIconButton("→", "Переместить фотографию вправо");
    const removeButton = makeIconButton("×", "Удалить фотографию", "danger");

    tile.className = "photo-tile";
    image.src = photo.previewUrl || resolveImageUrl(photo.path);
    image.alt = `${hall.title || "Зал"}: фотография ${index + 1}`;
    image.loading = "lazy";
    mainBadge.className = "photo-main-badge";
    mainBadge.textContent = "Главная";
    controls.className = "photo-tile-controls";
    caption.textContent = `Фото ${index + 1}`;

    mainButton.disabled = index === 0;
    leftButton.disabled = index === 0;
    rightButton.disabled = index === hall.images.length - 1;
    mainButton.addEventListener("click", () => movePhoto(hall, index, -index));
    leftButton.addEventListener("click", () => movePhoto(hall, index, -1));
    rightButton.addEventListener("click", () => movePhoto(hall, index, 1));
    removeButton.addEventListener("click", () => removePhoto(hall, index));

    if (index === 0) tile.append(mainBadge);
    controls.append(mainButton, leftButton, rightButton, removeButton);
    tile.append(image, caption, controls);
    return tile;
  }

  function renderHalls() {
    hallsList.replaceChildren();
    state.halls.forEach((hall, index) => {
      const article = document.createElement("article");
      const fields = document.createElement("div");
      const head = document.createElement("div");
      const heading = document.createElement("h2");
      const controls = document.createElement("div");
      const upButton = makeIconButton("↑", "Переместить зал выше");
      const downButton = makeIconButton("↓", "Переместить зал ниже");
      const deleteButton = makeIconButton("×", "Удалить зал", "danger");
      const titleLabel = document.createElement("label");
      const titleCaption = document.createElement("span");
      const titleInput = document.createElement("input");
      const descriptionLabel = document.createElement("label");
      const descriptionCaption = document.createElement("span");
      const descriptionInput = document.createElement("textarea");
      const taglineLabel = document.createElement("label");
      const taglineCaption = document.createElement("span");
      const taglineInput = document.createElement("input");
      const galleryEditor = document.createElement("section");
      const galleryHead = document.createElement("div");
      const galleryTitle = document.createElement("h3");
      const galleryHint = document.createElement("p");
      const photoGrid = document.createElement("div");
      const uploadButton = document.createElement("button");
      const fileInput = document.createElement("input");

      article.className = "hall-editor";
      fields.className = "hall-fields";
      head.className = "hall-card-head";
      controls.className = "hall-controls";
      galleryEditor.className = "gallery-editor";
      galleryHead.className = "gallery-editor-head";
      photoGrid.className = "photo-grid";
      uploadButton.className = "button button-secondary";
      fileInput.className = "file-input";

      heading.textContent = `Зал ${index + 1}`;
      titleCaption.textContent = "Название";
      titleInput.type = "text";
      titleInput.value = hall.title;
      titleInput.maxLength = 80;
      titleInput.required = true;
      taglineCaption.textContent = "Короткая метка";
      taglineInput.type = "text";
      taglineInput.value = hall.tagline;
      taglineInput.maxLength = 80;
      descriptionCaption.textContent = "Описание";
      descriptionInput.value = hall.description;
      descriptionInput.maxLength = 1000;
      descriptionInput.required = true;
      galleryTitle.textContent = "Фотографии зала";
      galleryHint.textContent = "Первая фотография используется как обложка. Стрелками меняйте порядок.";
      uploadButton.type = "button";
      uploadButton.textContent = "+ Загрузить фотографии";
      fileInput.type = "file";
      fileInput.accept = "image/jpeg,image/png,image/webp";
      fileInput.multiple = true;
      fileInput.setAttribute("aria-label", `Загрузить фотографии для зала ${index + 1}`);

      upButton.disabled = index === 0;
      downButton.disabled = index === state.halls.length - 1;
      uploadButton.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => handleImageSelection(hall, fileInput.files));
      titleInput.addEventListener("input", () => { hall.title = titleInput.value; markChanged(); });
      taglineInput.addEventListener("input", () => { hall.tagline = taglineInput.value; markChanged(); });
      descriptionInput.addEventListener("input", () => { hall.description = descriptionInput.value; markChanged(); });
      upButton.addEventListener("click", () => moveHall(index, -1));
      downButton.addEventListener("click", () => moveHall(index, 1));
      deleteButton.addEventListener("click", () => deleteHall(index));

      controls.append(upButton, downButton, deleteButton);
      head.append(heading, controls);
      titleLabel.append(titleCaption, titleInput);
      taglineLabel.append(taglineCaption, taglineInput);
      descriptionLabel.append(descriptionCaption, descriptionInput);
      galleryHead.append(galleryTitle, galleryHint);
      photoGrid.append(...hall.images.map((photo, photoIndex) => createPhotoTile(hall, photo, photoIndex)));
      if (!hall.images.length) {
        const empty = document.createElement("p");
        empty.className = "photo-empty";
        empty.textContent = "Фотографий пока нет. Загрузите хотя бы одну перед публикацией.";
        photoGrid.append(empty);
      }
      galleryEditor.append(galleryHead, photoGrid, uploadButton, fileInput);
      fields.append(head, titleLabel, taglineLabel, descriptionLabel, galleryEditor);
      article.append(fields);
      hallsList.append(article);
    });
  }

  function moveHall(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.halls.length) return;
    const [hall] = state.halls.splice(index, 1);
    state.halls.splice(nextIndex, 0, hall);
    renderHalls();
    markChanged();
  }

  function movePhoto(hall, index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= hall.images.length || !direction) return;
    const [photo] = hall.images.splice(index, 1);
    hall.images.splice(nextIndex, 0, photo);
    renderHalls();
    markChanged();
  }

  function removePhoto(hall, index) {
    const photo = hall.images[index];
    if (!window.confirm("Удалить эту фотографию? Изменение вступит в силу после сохранения.")) return;
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    hall.images.splice(index, 1);
    renderHalls();
    markChanged();
  }

  function deleteHall(index) {
    const hall = state.halls[index];
    const label = hall.title || `зал ${index + 1}`;
    if (!window.confirm(`Удалить «${label}»? Изменение вступит в силу после сохранения.`)) return;
    hall.images.forEach((photo) => photo.previewUrl && URL.revokeObjectURL(photo.previewUrl));
    state.halls.splice(index, 1);
    renderHalls();
    markChanged();
  }

  function addHall() {
    state.halls.push({ id: createHallId(), title: "Новый зал", description: "Добавьте описание зала.", tagline: "банкетное пространство", images: [] });
    renderHalls();
    markChanged();
    hallsList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function optimizeImage(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Поддерживаются только JPG, PNG и WebP.");
    if (file.size > 12 * 1024 * 1024) throw new Error("Одна фотография должна быть меньше 12 МБ.");
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) throw new Error("Не удалось обработать фотографию.");
    return blob;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Не удалось прочитать фотографию."));
      reader.readAsDataURL(blob);
    });
  }

  async function handleImageSelection(hall, fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const availableSlots = maxImagesPerHall - hall.images.length;
    if (availableSlots <= 0) {
      setStatus(editorStatus, `Для одного зала можно добавить до ${maxImagesPerHall} фотографий.`, "error");
      return;
    }
    const selected = files.slice(0, availableSlots);
    setStatus(editorStatus, `Обрабатываем ${selected.length} фото…`);
    try {
      const stamp = Date.now();
      const photos = await Promise.all(selected.map(async (file, index) => {
        const blob = await optimizeImage(file);
        const content = await blobToBase64(blob);
        const path = `assets/photos/${hall.id}-${stamp}-${index + 1}.webp`;
        return makePhoto(path, URL.createObjectURL(blob), { path, content });
      }));
      hall.images.push(...photos);
      renderHalls();
      markChanged();
      setStatus(editorStatus, `Добавлено фото: ${photos.length}. Не забудьте сохранить изменения.`, "success");
    } catch (error) {
      setStatus(editorStatus, error.message, "error");
    }
  }

  function validateHalls() {
    for (const hall of state.halls) {
      hall.title = hall.title.trim();
      hall.description = hall.description.trim();
      hall.tagline = hall.tagline.trim() || "M HALL";
      if (!hall.title || !hall.description || !hall.images.length) throw new Error("У каждого зала должны быть название, описание и хотя бы одна фотография.");
    }
  }

  async function saveHalls() {
    if (state.isSaving) return;
    try { validateHalls(); } catch (error) { setStatus(editorStatus, error.message, "error"); return; }
    if (!state.halls.length && !window.confirm("Опубликовать сайт без залов?")) return;
    state.isSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = "Публикуем…";
    setStatus(editorStatus, "Сохраняем изменения в GitHub…");

    const publicHalls = state.halls.map((hall) => {
      const images = getHallImagePaths(hall);
      return { id: hall.id, title: hall.title, description: hall.description, tagline: hall.tagline, image: images[0], images };
    });
    const uploads = state.halls.flatMap((hall) => hall.images.map((photo) => photo.upload).filter(Boolean));
    const currentImages = new Set(publicHalls.flatMap((hall) => hall.images).filter(isManagedImage));
    const deletedImages = [...state.originalImages].filter((path) => !currentImages.has(path));

    try {
      const result = await request("/api/publish", { method: "POST", body: JSON.stringify({ halls: publicHalls, uploads, deletedImages }) });
      state.originalImages = currentImages;
      state.halls.forEach((hall) => hall.images.forEach((photo) => { photo.upload = null; }));
      const shortSha = result.commitSha ? ` Коммит ${result.commitSha.slice(0, 7)}.` : "";
      setStatus(editorStatus, `Сохранено.${shortSha} Сайт обновится примерно через 1–2 минуты.`, "success");
    } catch (error) {
      if (error.status === 401) logout("Сессия истекла. Войдите ещё раз.");
      else setStatus(editorStatus, error.message, "error");
    } finally {
      state.isSaving = false;
      saveButton.disabled = false;
      saveButton.textContent = "Сохранить и опубликовать";
    }
  }

  async function showEditor() {
    show(loginViews, false);
    show(editorViews, true);
    setStatus(editorStatus, "Загружаем данные…");
    try { await loadHalls(); setStatus(editorStatus); } catch (error) { setStatus(editorStatus, error.message, "error"); }
  }

  function logout(message = "") {
    state.token = "";
    sessionStorage.removeItem(sessionKey);
    show(editorViews, false);
    show(loginViews, true);
    loginForm.reset();
    loginForm.elements.username.value = "admin";
    setStatus(loginStatus, message, message ? "error" : "");
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    loginButton.disabled = true;
    loginButton.textContent = "Входим…";
    setStatus(loginStatus);
    try {
      const result = await request("/api/login", { method: "POST", body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }) });
      state.token = result.token;
      sessionStorage.setItem(sessionKey, state.token);
      await showEditor();
    } catch (error) {
      setStatus(loginStatus, error.message, "error");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Войти";
    }
  });

  addHallButton.addEventListener("click", addHall);
  saveButton.addEventListener("click", saveHalls);
  logoutButton.addEventListener("click", () => logout());

  async function restoreSession() {
    if (!state.token || !apiUrl) return;
    try { await request("/api/session", { method: "GET" }); await showEditor(); } catch { logout(); }
  }

  restoreSession();
})();
