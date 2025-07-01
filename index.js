// js/index.js

// =====================
// 1) Работа с IndexedDB
// =====================
const DB_NAME = "LocomotivesEngineersDB";
const DB_VERSION = 2; // Повысили версию, чтобы добавить новое хранилище “columns”
let db;

/**
 * Открываем (или создаём) IndexedDB
 *  - Хранилище "columns" (ключ — columnId, поля: title)
 *  - Хранилище "subcolumns" (ключ — subId, поля: columnId, title)
 *  - Хранилище "cards" (ключ — id, поля: type, name, code, position, columnId, subId)
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (event) {
      const database = event.target.result;

      // 1. Хранилище для основных колонок
      if (!database.objectStoreNames.contains("columns")) {
        const store = database.createObjectStore("columns", {
          keyPath: "columnId",
        });
        // Поля: columnId (unique), title (название колонки)
        store.createIndex("by_title", "title", { unique: false });
      }

      // 2. Хранилище для подколонок
      if (!database.objectStoreNames.contains("subcolumns")) {
        const store = database.createObjectStore("subcolumns", {
          keyPath: "subId",
        });
        // Поля: subId (unique), columnId (к какой колонке принадлежит), title
        store.createIndex("by_column", "columnId", { unique: false });
      }

      // 3. Хранилище для карточек
      if (!database.objectStoreNames.contains("cards")) {
        const store = database.createObjectStore("cards", { keyPath: "id" });
        // Поля: id (unique), type, name, code, position, columnId, subId
        store.createIndex("by_column_sub", ["columnId", "subId"], {
          unique: false,
        });
      }
    };

    request.onsuccess = function (event) {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = function (event) {
      console.error("Ошибка при открытии IndexedDB:", event.target.error);
      reject(event.target.error);
    };
  });
}

// ------------- Работа с хранилищем "columns" -------------

/**
 * Добавить новую основную колонку в IndexedDB
 * @param {string} title – отображаемое название колонки
 * @returns {Promise<Object>} – возвращает объект columnId, title
 */
function addColumnToDB(title) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("columns", "readwrite");
    const store = tx.objectStore("columns");
    const columnId = "col-" + Date.now(); // генерируем уникальный columnId
    const newColumn = { columnId, title };
    const request = store.add(newColumn);
    request.onsuccess = () => resolve(newColumn);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Получить все колонки из IndexedDB
 * @returns {Promise<Array<Object>>} – массив { columnId, title }
 */
function getAllColumns() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("columns", "readonly");
    const store = tx.objectStore("columns");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Удалить основную колонку (по columnId) из IndexedDB
 * При этом удаляем ВСЕ её подколонки и ВСЕ карточки, связанные с этими подколонками
 * @param {string} columnId
 * @returns {Promise<void>}
 */
function deleteColumnFromDB(columnId) {
  return new Promise((resolve, reject) => {
    // Нам нужен транзакционный доступ к трём сторожам сразу
    const tx = db.transaction(["columns", "subcolumns", "cards"], "readwrite");
    const columnsStore = tx.objectStore("columns");
    const subsStore = tx.objectStore("subcolumns");
    const cardsStore = tx.objectStore("cards");

    // 1) Удаляем саму колонку
    columnsStore.delete(columnId);

    // 2) Находим все подколонки, привязанные к этой columnId
    const subsIndex = subsStore.index("by_column");
    const range = IDBKeyRange.only(columnId);
    const subsRequest = subsIndex.getAll(range);

    subsRequest.onsuccess = function (event) {
      const subs = event.target.result;
      // Удаляем каждую подколонку и все карточки, у которых subId совпадает
      subs.forEach((sub) => {
        subsStore.delete(sub.subId);

        // Удаляем все карточки для этой subId
        const cardsReq = cardsStore
          .index("by_column_sub")
          .getAll([columnId, sub.subId]);
        cardsReq.onsuccess = function (ev) {
          const cards = ev.target.result;
          cards.forEach((card) => {
            cardsStore.delete(card.id);
          });
        };
      });
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ------------- Работа с хранилищем "subcolumns" -------------

/**
 * Добавить новую подколонку в IndexedDB
 * @param {string} columnId – id основной колонки, к которой будет принадлежать
 * @param {string} title – отображаемое название подколонки
 * @returns {Promise<Object>} – возвращает объект subId, columnId, title
 */
function addSubcolumnToDB(columnId, title) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("subcolumns", "readwrite");
    const store = tx.objectStore("subcolumns");
    const subId = "sub-" + Date.now();
    const newSub = { subId, columnId, title };
    const request = store.add(newSub);
    request.onsuccess = () => resolve(newSub);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Получить все подколонки для конкретной основной колонки
 * @param {string} columnId
 * @returns {Promise<Array<Object>>} – массив subId, columnId, title
 */
function getSubcolumnsByColumn(columnId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("subcolumns", "readonly");
    const store = tx.objectStore("subcolumns");
    const index = store.index("by_column");
    const request = index.getAll(IDBKeyRange.only(columnId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Удалить подколонку (по subId) из IndexedDB
 * При этом удаляем все карточки, связанные с этой subId
 * @param {string} subId
 * @returns {Promise<void>}
 */
function deleteSubcolumnFromDB(subId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["subcolumns", "cards"], "readwrite");
    const subsStore = tx.objectStore("subcolumns");
    const cardsStore = tx.objectStore("cards");

    // Удаляем подколонку
    subsStore.delete(subId);

    // Удаляем все карточки, у которых card.subId === subId
    const getAllReq = cardsStore.getAll();
    getAllReq.onsuccess = function (event) {
      const allCards = event.target.result;
      allCards.forEach((card) => {
        if (card.subId === subId) {
          cardsStore.delete(card.id);
        }
      });
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Создаёт карточку помощника машиниста, рендерит в DOM и сохраняет в IndexedDB
 * @param {string} columnId
 * @param {string} subId
 */
async function createAssistantCard(columnId, subId) {
  const position = prompt("Должность помощника:");
  if (!position) return;
  const name = prompt("ФИО помощника машиниста:");
  if (!name) return;
  const code = prompt("Табельный номер:");
  if (!code) return;
  const photoUrl = prompt("Ссылка на фото (опционально):");

  const id = "ast-" + Date.now();
  const newCard = {
    id,
    type: "assistant",
    name,
    code,
    position,
    photoUrl,
    columnId,
    subId,
  };

  await addCardToDB(newCard);
  const container = document.getElementById(`${columnId}-${subId}`);
  const cardElem = createCardElement(newCard);
  container.appendChild(cardElem);
}

// ------------- Работа с хранилищем "cards" -------------

/**
 * Добавить новую карточку в IndexedDB
 * @param {Object} card – { id, type, name, code, position, columnId, subId }
 * @returns {Promise<void>}
 */
function addCardToDB(card) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const request = store.add(card);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Обновить карточку в IndexedDB
 * @param {Object} card – изменённый объект карточки
 * @returns {Promise<void>}
 */
function updateCardInDB(card) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const request = store.put(card);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);

    // при обновлении DOM после сохранения:
    const img = cardElem.querySelector("img");
    if (img) {
      img.src = newPhoto;
    } else if (newPhoto) {
      const newImg = document.createElement("img");
      newImg.src = newPhoto;
      newImg.classList.add("card-photo");
      cardElem.insertBefore(newImg, cardElem.firstChild);
    }
  });
}

/**
 * Удалить карточку из IndexedDB по id
 * @param {string} cardId
 * @returns {Promise<void>}
 */
function deleteCardFromDB(cardId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const request = store.delete(cardId);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Получить все карточки из IndexedDB
 * @returns Promise<Array<Object>>> – массив всех карточек
 */
function getAllCards() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readonly");
    const store = tx.objectStore("cards");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Переместить карточку (изменить её columnId и subId) в IndexedDB
 * @param {string} cardId
 * @param {string} newColumnId
 * @param {string} newSubId
 * @returns {Promise<void>}
 */
function moveCardInDB(cardId, newColumnId, newSubId = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const getReq = store.get(cardId);

    getReq.onsuccess = function (event) {
      const card = event.target.result;
      if (!card) {
        reject("Карточка не найдена");
        return;
      }
      card.columnId = newColumnId;
      card.subId = newSubId; // Может быть null
      const updateReq = store.put(card);
      updateReq.onsuccess = () => resolve();
      updateReq.onerror = (e) => reject(e.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

// ====================================
// 2) Отрисовка колонок, подколонок и карточек
// ====================================

/**
 * Создаёт DOM-элемент основной колонки (columnId, title)
 * и сразу вызывает рендер всех её подколонок.
 * @param {Object} column – columnId, title
 */
async function renderColumn(column) {
  const board = document.getElementById("board");

  // Обёртка для колонки
  const colDiv = document.createElement("div");
  colDiv.classList.add("column");
  colDiv.setAttribute("data-column", column.columnId);

  // Заголовок колонки
  const header = document.createElement("div");
  header.classList.add("column-header");
  const h2 = document.createElement("h2");
  h2.textContent = column.title;

  // Кнопка удаления колонки
  const delColBtn = document.createElement("button");
  delColBtn.classList.add("delete-column-btn");
  delColBtn.textContent = "×";
  delColBtn.style.cssText = `
    background:rgb(255, 124, 114);
    color: #fff;
    border: none;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 14px;
    cursor: pointer;
  `;
  delColBtn.addEventListener("click", async () => {
    if (
      !confirm(
        `Удалить всю колонку "${column.title}"? Все подколонки и карточки будут потеряны.`
      )
    )
      return;
    await deleteColumnFromDB(column.columnId);
    colDiv.remove();
  });

  header.append(h2, delColBtn);
  colDiv.appendChild(header);

  // Получаем подколонки из БД
  let subs = await getSubcolumnsByColumn(column.columnId);

  // Контейнер для карточек в колонке (если нет подколонок)
  const directCardsContainer = document.createElement("div");
  directCardsContainer.classList.add("card-container");
  directCardsContainer.id = `direct-cards-${column.columnId}`;
  colDiv.appendChild(directCardsContainer);

  // Создаем контейнер для подколонок ТОЛЬКО если они есть
  if (subs.length > 0) {
    const subsContainer = document.createElement("div");
    subsContainer.classList.add("subcolumns");
    subsContainer.id = `subs-${column.columnId}`;
    colDiv.appendChild(subsContainer);

    // Рендерим подколонки
    subs.forEach(renderSubcolumn);
    directCardsContainer.style.display = "none"; // Скрываем контейнер для прямого перетаскивания
  } else {
    directCardsContainer.style.display = "block"; // Показываем контейнер для прямого перетаскивания
  }

  // Кнопка "+ Подколонку"
  const addSubBtn = document.createElement("button");
  addSubBtn.classList.add("add-subcolumn-btn");
  addSubBtn.setAttribute("data-column", column.columnId);
  addSubBtn.textContent = "+ Подколонку";
  colDiv.appendChild(addSubBtn);

  board.appendChild(colDiv);

  // Инициализация SortableJS для колонки (если нет подколонок)
  new Sortable(directCardsContainer, {
    group: "cards",
    animation: 150,
    ghostClass: "sortable-ghost",
    onEnd: async (evt) => {
      const cardElem = evt.item;
      const cardId = cardElem.getAttribute("data-id");
      await moveCardInDB(cardId, column.columnId, null);
    },
  });

  // Обработчик кнопки "+ Подколонку"
  addSubBtn.addEventListener("click", async () => {
    const title = prompt("Название новой подколонки:");
    if (!title) return;

    const newSub = await addSubcolumnToDB(column.columnId, title);

    // Если это первая подколонка - создаем контейнер для подколонок
    if (subs.length === 0) {
      const subsContainer = document.createElement("div");
      subsContainer.classList.add("subcolumns");
      subsContainer.id = `subs-${column.columnId}`;
      colDiv.insertBefore(subsContainer, addSubBtn);
      directCardsContainer.style.display = "none";
    }

    renderSubcolumn(newSub);
    subs.push(newSub); // Обновляем локальный список подколонок
  });
}
/**
 * Функция создаёт контейнер подколонки в DOM.
 * @param {Object} sub – { subId, columnId, title }
 */
function renderSubcolumn(sub) {
  const subsContainer = document.querySelector(`#subs-${sub.columnId}`);
  if (!subsContainer) return;

  // Получаем контейнер основной колонки и его карточки
  const directCardsContainer = document.querySelector(
    `#direct-cards-${sub.columnId}`
  );
  const columnElement = document.querySelector(
    `.column[data-column="${sub.columnId}"]`
  );

  // 1) Создаём .subcolumn
  const subDiv = document.createElement("div");
  subDiv.classList.add("subcolumn");
  subDiv.setAttribute("data-sub", sub.subId);
  subDiv.setAttribute("data-column", sub.columnId);

  // Заголовок подколонки + кнопка удалить
  const header = document.createElement("div");
  header.classList.add("subcolumn-header");
  const titleEl = document.createElement("h3");
  titleEl.textContent = sub.title;
  const delBtn = document.createElement("button");
  delBtn.classList.add("delete-subcolumn-btn");
  delBtn.textContent = "×";
  subDiv.appendChild(header);
  header.append(titleEl, delBtn);

  // 2) Контейнер для карточек
  const cardsContainer = document.createElement("div");
  cardsContainer.classList.add("card-container");
  cardsContainer.id = `${sub.columnId}-${sub.subId}`;
  subDiv.appendChild(cardsContainer);

  // 3) Кнопка "+ Добавить карточку"
  const addCardBtn = document.createElement("button");
  addCardBtn.classList.add("add-card-btn");
  addCardBtn.setAttribute("data-column", sub.columnId);
  addCardBtn.setAttribute("data-sub", sub.subId);
  addCardBtn.textContent = "Добавить";
  subDiv.appendChild(addCardBtn);

  // Вставляем подколонку в DOM
  subsContainer.appendChild(subDiv);

  // 4) Переносим карточки из основной колонки (если есть)
  if (directCardsContainer && directCardsContainer.children.length > 0) {
    const cards = Array.from(directCardsContainer.children);
    cards.forEach(async (card) => {
      const cardId = card.getAttribute("data-id");
      cardsContainer.appendChild(card);
      await moveCardInDB(cardId, sub.columnId, sub.subId);
    });
    directCardsContainer.style.display = "none";
  }

  // 5) Инициализация SortableJS
  new Sortable(cardsContainer, {
    group: "cards",
    animation: 150,
    ghostClass: "sortable-ghost",
    onEnd: async (evt) => {
      const cardElem = evt.item;
      const cardId = cardElem.getAttribute("data-id");
      const newColumnId = cardElem
        .closest(".column")
        .getAttribute("data-column");
      const newSubId =
        cardElem.closest(".subcolumn")?.getAttribute("data-sub") || null;
      await moveCardInDB(cardId, newColumnId, newSubId);
    },
  });

  // 6) Обработчик удаления подколонки
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Удалить подколонку "${sub.title}" и все её карточки?`))
      return;

    // Переносим карточки обратно в основную колонку
    const cards = Array.from(cardsContainer.children);
    if (directCardsContainer) {
      cards.forEach(async (card) => {
        const cardId = card.getAttribute("data-id");
        directCardsContainer.appendChild(card);
        await moveCardInDB(cardId, sub.columnId, null);
      });
      directCardsContainer.style.display = "block";
    }

    await deleteSubcolumnFromDB(sub.subId);
    subDiv.remove();

    // Если это была последняя подколонка - удаляем контейнер
    if (subsContainer.children.length === 0) {
      subsContainer.remove();
    }
  });

  // 7) Обработчик добавления карточки
  addCardBtn.addEventListener("click", () => {
    openAddCardModal(sub.columnId, sub.subId);
  });
}

/**
 * Отрисовать все карточки из IndexedDB в соответствующие контейнеры
 */
async function renderAllCards() {
  const allCards = await getAllCards();
  allCards.forEach((card) => {
    const container = card.subId
      ? document.getElementById(`${card.columnId}-${card.subId}`)
      : document.getElementById(`direct-cards-${card.columnId}`);
    if (!container) return;
    const cardElem = createCardElement(card);
    container.appendChild(cardElem);
  });
}

/**
 * Создаёт DOM-элемент карточки по объекту card
 * @param {Object} card – { id, type, name, code, position, columnId, subId }
 * @returns {HTMLElement}
 */
function createCardElement(card) {
  const cardDiv = document.createElement("div");
  cardDiv.classList.add("card");

  // Добавляем класс в зависимости от типа карточки
  if (card.type === "locomotive") {
    cardDiv.classList.add("card-locomotive");
  } else if (card.type === "engineer") {
    cardDiv.classList.add("card-engineer");
  } else if (card.type === "assistant") {
    cardDiv.classList.add("card-assistant");
  }

  cardDiv.setAttribute("data-type", card.type);
  cardDiv.setAttribute("data-id", card.id);

  // Основное содержимое карточки
  const contentWrapper = document.createElement("div");
  contentWrapper.classList.add("card-content");

  // Фото (если есть)
  if (card.photoUrl) {
    const img = document.createElement("img");
    img.src = card.photoUrl;
    img.alt = "Фото";
    img.classList.add("card-photo-side");
    contentWrapper.appendChild(img);
  }

  // Текстовая часть
  const textDiv = document.createElement("div");
  textDiv.classList.add("card-text");

  // Заголовок с названием
  const h4 = document.createElement("h4");
  if (card.type === "locomotive") {
    h4.textContent = `Тепловоз: ${card.name}`;
  } else if (card.type === "engineer") {
    h4.textContent = `Машинист: ${card.name}`;
  } else if (card.type === "assistant") {
    h4.textContent = `Помощник: ${card.name}`;
  }
  textDiv.appendChild(h4);

  // Поля в зависимости от типа карточки
  if (card.type === "locomotive") {
    // Только код для тепловоза
    const pCode = document.createElement("p");
    pCode.innerHTML = `<strong>Код:</strong> ${card.code}`;
    textDiv.appendChild(pCode);
  } else {
    // Для машиниста и помощника - должность и табельный номер
    const pPos = document.createElement("p");
    pPos.innerHTML = `<strong>Должность:</strong> ${card.position}`;

    const pCode = document.createElement("p");
    pCode.innerHTML = `<strong>Табельный:</strong> ${card.code}`;

    textDiv.append(pPos, pCode);
  }

  contentWrapper.appendChild(textDiv);
  cardDiv.appendChild(contentWrapper);

  // Кнопки действий
  const actions = document.createElement("div");
  actions.classList.add("card-actions");

  const editBtn = document.createElement("button");
  editBtn.classList.add("edit-btn");
  editBtn.textContent = "✏️";
  editBtn.title = "Редактировать";

  const delBtn = document.createElement("button");
  delBtn.classList.add("delete-btn");
  delBtn.textContent = "🗑️";
  delBtn.title = "Удалить";

  actions.append(editBtn, delBtn);
  cardDiv.appendChild(actions);

  return cardDiv;
}

// ============================================
// 3) CRUD карточек + делегирование кликов
// ============================================

/**
 * Открывает prompt() для добавления карточки
 * @param {string} columnId
 * @param {string} subId
 */
function openAddCardModal(columnId, subId) {
  const type = prompt(
    "Введите тип карточки:\n1 – Тепловоз\n2 – Машинист\n3 – Помощник машиниста",
    "1"
  );
  if (!type) return;
  if (type === "1") {
    createLocomotiveCard(columnId, subId);
  } else if (type === "2") {
    createEngineerCard(columnId, subId);
  } else if (type === "3") {
    createAssistantCard(columnId, subId);
  } else {
    alert("Неверный тип");
  }
}

/**
 * Создаёт карточку тепловоза, рендерит в DOM и сохраняет в IndexedDB
 * @param {string} columnId
 * @param {string} subId
 */
async function createLocomotiveCard(columnId, subId) {
  const name = prompt("Название тепловоза:");
  if (!name) return;
  const code = prompt("Код тепловоза:");
  if (!code) return;
  const photoUrl = prompt("Ссылка на фото тепловоза (опционально):");

  const id = "loco-" + Date.now();
  const newCard = {
    id,
    type: "locomotive",
    name,
    code,
    position: null,
    photoUrl,
    columnId,
    subId,
  };

  await addCardToDB(newCard);
  const container = document.getElementById(`${columnId}-${subId}`);
  const cardElem = createCardElement(newCard);
  container.appendChild(cardElem);
}

/**
 * Создаёт карточку машиниста, рендерит в DOM и сохраняет в IndexedDB
 * @param {string} columnId
 * @param {string} subId
 */
async function createEngineerCard(columnId, subId) {
  const position = prompt("Вазифа машиниста:");
  if (!position) return;
  const name = prompt("ФИО машиниста:");
  if (!name) return;
  const code = prompt("Код машиниста:");
  if (!code) return;
  const photoUrl = prompt("Ссылка на фото машиниста (опционально):");

  const id = "eng-" + Date.now();
  const newCard = {
    id,
    type: "engineer",
    name,
    code,
    position,
    photoUrl,
    columnId,
    subId,
  };

  await addCardToDB(newCard);
  const container = document.getElementById(`${columnId}-${subId}`);
  const cardElem = createCardElement(newCard);
  container.appendChild(cardElem);
}

/**
 * Делегируем клики на “Редактировать” и “Удалить” внутри карточек
 */
function delegateCardActions() {
  document.body.addEventListener("click", async (e) => {
    if (e.target.classList.contains("edit-btn")) {
      const cardElem = e.target.closest(".card");
      if (!cardElem) return;
      await openEditCardModal(cardElem);
    }
    if (e.target.classList.contains("delete-btn")) {
      const cardElem = e.target.closest(".card");
      if (!cardElem) return;
      await deleteCardHandler(cardElem);
    }
  });
}

/**
 * Открывает prompt() для редактирования карточки и сохраняет изменения
 * @param {HTMLElement} cardElem
 */
async function openEditCardModal(cardElem) {
  const type = cardElem.getAttribute("data-type");
  const id = cardElem.getAttribute("data-id");

  const tx = db.transaction("cards", "readonly");
  const store = tx.objectStore("cards");
  const getReq = store.get(id);

  getReq.onsuccess = function () {
    const card = getReq.result;
    if (!card) return;

    // Общие элементы для всех типов карточек
    const h4 = cardElem.querySelector("h4");
    const paragraphs = cardElem.querySelectorAll("p");

    if (card.type === "locomotive") {
      // Редактирование тепловоза
      const newName = prompt("Новое название тепловоза:", card.name);
      if (!newName) return;
      const newCode = prompt("Новый код тепловоза:", card.code);
      if (!newCode) return;
      const newPhoto = prompt("Новая ссылка на фото:", card.photoUrl || "");

      card.name = newName;
      card.code = newCode;
      card.photoUrl = newPhoto;

      updateCardInDB(card).then(() => {
        h4.textContent = `Тепловоз: ${newName}`;
        paragraphs[0].innerHTML = `<strong>Код:</strong> ${newCode}`;

        // Обновление фото если оно есть
        const img = cardElem.querySelector("img");
        if (newPhoto) {
          if (img) {
            img.src = newPhoto;
          } else {
            const newImg = document.createElement("img");
            newImg.src = newPhoto;
            newImg.classList.add("card-photo-side");
            cardElem
              .querySelector(".card-content")
              .insertBefore(newImg, cardElem.querySelector(".card-text"));
          }
        } else if (img) {
          img.remove();
        }
      });
    } else if (card.type === "engineer") {
      // Редактирование машиниста
      const newPosition = prompt("Новая должность:", card.position);
      if (!newPosition) return;
      const newName = prompt("ФИО машиниста:", card.name);
      if (!newName) return;
      const newCode = prompt("Табельный номер:", card.code);
      if (!newCode) return;
      const newPhoto = prompt("Ссылка на фото:", card.photoUrl || "");

      card.position = newPosition;
      card.name = newName;
      card.code = newCode;
      card.photoUrl = newPhoto;

      updateCardInDB(card).then(() => {
        h4.textContent = `Машинист: ${newName}`;
        paragraphs[0].innerHTML = `<strong>Должность:</strong> ${newPosition}`;
        paragraphs[1].innerHTML = `<strong>Табельный:</strong> ${newCode}`;

        // Обновление фото
        const img = cardElem.querySelector("img");
        if (newPhoto) {
          if (img) {
            img.src = newPhoto;
          } else {
            const newImg = document.createElement("img");
            newImg.src = newPhoto;
            newImg.classList.add("card-photo-side");
            cardElem
              .querySelector(".card-content")
              .insertBefore(newImg, cardElem.querySelector(".card-text"));
          }
        } else if (img) {
          img.remove();
        }
      });
    } else if (card.type === "assistant") {
      // Редактирование помощника машиниста
      const newPosition = prompt("Новая должность помощника:", card.position);
      if (!newPosition) return;
      const newName = prompt("ФИО помощника:", card.name);
      if (!newName) return;
      const newCode = prompt("Табельный номер:", card.code);
      if (!newCode) return;
      const newPhoto = prompt("Ссылка на фото:", card.photoUrl || "");

      card.position = newPosition;
      card.name = newName;
      card.code = newCode;
      card.photoUrl = newPhoto;

      updateCardInDB(card).then(() => {
        h4.textContent = `Помощник: ${newName}`;
        paragraphs[0].innerHTML = `<strong>Должность:</strong> ${newPosition}`;
        paragraphs[1].innerHTML = `<strong>Табельный:</strong> ${newCode}`;

        // Обновление фото
        const img = cardElem.querySelector("img");
        if (newPhoto) {
          if (img) {
            img.src = newPhoto;
          } else {
            const newImg = document.createElement("img");
            newImg.src = newPhoto;
            newImg.classList.add("card-photo-side");
            cardElem
              .querySelector(".card-content")
              .insertBefore(newImg, cardElem.querySelector(".card-text"));
          }
        } else if (img) {
          img.remove();
        }
      });
    }
  };

  getReq.onerror = function (event) {
    console.error("Ошибка при получении карточки:", event.target.error);
  };
}
/**
 * Удаляет карточку из DOM и из IndexedDB
 * @param {HTMLElement} cardElem
 */
async function deleteCardHandler(cardElem) {
  const id = cardElem.getAttribute("data-id");
  if (!confirm("Удалить эту карточку?")) return;
  await deleteCardFromDB(id);
  cardElem.remove();
}

// ========================================
// 4) Инициализация: собираем воедино всё
// ========================================

/**
 * Главный init-функция, срабатывающая после загрузки DOM
 */
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Открываем IndexedDB
  await openDB();

  // 2) Проверяем, есть ли в БД хотя бы одна основная колонка.
  //    Если нет — создаём три дефолтных.
  let columns = await getAllColumns();
  if (columns.length === 0) {
    // const c1 = await addColumnToDB('Грузовые перевозки');
    // const c2 = await addColumnToDB('Манёвр');
    // const c3 = await addColumnToDB('Табель сотрудников');
    // columns = [c1, c2, c3];
    columns = [];
  }

  // 3) Рендерим каждую основную колонку
  for (const column of columns) {
    await renderColumn(column);
  }

  // 4) Рендерим все карточки (в нужные подколонки)
  await renderAllCards();

  // 5) Делегирование кликов на “Редактировать / Удалить” у карточек
  delegateCardActions();

  // 6) Обработчик кнопки “+ Добавить колонку”
  const addColumnBtn = document.getElementById("add-column-btn");
  addColumnBtn.addEventListener("click", async () => {
    const title = prompt("Название новой колонки:");
    if (!title) return;
    const newCol = await addColumnToDB(title);
    await renderColumn(newCol);
  });
});
