// js/index.js

// =====================
// 1) Работа с IndexedDB
// =====================
const DB_NAME = "LocomotivesEngineersDB";
const DB_VERSION = 3; // Повысили версию, чтобы добавить новое хранилище “columns”
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
        store.createIndex("by_order", "order", { unique: false });
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
    const newColumn = { columnId, title, order: Date.now() };
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
function moveCardInDB(cardId, newColumnId, newSubId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    const getReq = store.get(cardId);
    getReq.onsuccess = function (event) {
      const card = event.target.result;
      if (!card) {
        reject("Карточка не найдена при перемещении");
        return;
      }
      card.columnId = newColumnId;
      card.subId = newSubId;
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
  // 1. Шаблон для DOM-структуры колонки
  //    <div class="column" data-column="columnId">
  //      <div class="column-header">
  //        <h2>title</h2>
  //        <button class="delete-column-btn">×</button>
  //      </div>
  //      <div class="subcolumns" id="subs-<columnId>"></div>
  //      <button class="add-subcolumn-btn" data-column="columnId">+ Подколонку</button>
  //    </div>

  const board = document.getElementById("board");

  // Обёртка для колонки
  const colDiv = document.createElement("div");
  colDiv.classList.add("column");
  colDiv.setAttribute("data-column", column.columnId);

  // Заголовок колонки + кнопка “Удалить колонку”
  const header = document.createElement("div");
  header.classList.add("column-header");
  const h2 = document.createElement("h2");
  h2.textContent = column.title;

  // Кнопка удаления колонки
  const delColBtn = document.createElement("button");
  delColBtn.classList.add("delete-column-btn");
  delColBtn.textContent = "×";
  delColBtn.style.cssText = `
    background: #f44336;
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
    // 1) Удаляем из IndexedDB
    await deleteColumnFromDB(column.columnId);
    // 2) Удаляем из DOM
    colDiv.remove();
  });

  header.append(h2, delColBtn);
  colDiv.appendChild(header);

  // Контейнер для подколонок
  const subsContainer = document.createElement("div");
  subsContainer.classList.add("subcolumns");
  subsContainer.id = `subs-${column.columnId}`;
  colDiv.appendChild(subsContainer);

  // Кнопка «+ Подколонку»
  const addSubBtn = document.createElement("button");
  addSubBtn.classList.add("add-subcolumn-btn");
  addSubBtn.setAttribute("data-column", column.columnId);
  addSubBtn.textContent = "+ Подколонку";
  colDiv.appendChild(addSubBtn);

  // Вставляем колонку в доску
  board.appendChild(colDiv);

  // 2. После того как DOM-элемент основной колонки создан,
  //    нужно отрисовать её подколонки (из базы или дефолтные)
  let subs = await getSubcolumnsByColumn(column.columnId);

  // Если нет ни одной подколонки → создаём две дефолтные (“Отдых” / “На работе”)
  if (subs.length === 0) {
    // const def1 = await addSubcolumnToDB(column.columnId, 'Отдых');
    // const def2 = await addSubcolumnToDB(column.columnId, 'На работе');
    // subs = [def1, def2];
    subs = [];
  }

  // Рендерим каждую подколонку
  subs.forEach(renderSubcolumn);

  // 3. Обрабатываем кнопку “+ Подколонку” для этой колонки
  addSubBtn.addEventListener("click", async () => {
    const title = prompt("Название новой подколонки:");
    if (!title) return;
    const newSub = await addSubcolumnToDB(column.columnId, title);
    renderSubcolumn(newSub);
  });
  // Добавляем атрибут для Sortable (если ещё нет)
  colDiv.setAttribute("data-sortable-column", column.columnId);

  // Вставляем колонку в доску
  board.appendChild(colDiv);
}
async function createAssistantCard(columnId, subId) {
  const position = prompt("Позиция помощника машиниста:");
  if (!position) return;
  const name = prompt("ФИО помощника:");
  if (!name) return;
  const code = prompt("Код помощника:");
  if (!code) return;
  const photoUrl = prompt("Ссылка на фото помощника (опционально):");

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
/**
 * Функция создаёт контейнер подколонки в DOM.
 * @param {Object} sub – { subId, columnId, title }
 */
function renderSubcolumn(sub) {
  const subsContainer = document.querySelector(`#subs-${sub.columnId}`);
  if (!subsContainer) return;

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
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Удалить подколонку "${sub.title}" и все её карточки?`))
      return;
    await deleteSubcolumnFromDB(sub.subId);
    subDiv.remove();
  });

  header.append(titleEl, delBtn);
  subDiv.appendChild(header);

  // 2) Контейнер для карточек
  const cardsContainer = document.createElement("div");
  cardsContainer.classList.add("card-container");
  cardsContainer.id = `${sub.columnId}-${sub.subId}`;
  subDiv.appendChild(cardsContainer);

  // 3) Кнопка “+ Добавить карточку”
  const addCardBtn = document.createElement("button");
  addCardBtn.classList.add("add-card-btn");
  addCardBtn.setAttribute("data-column", sub.columnId);
  addCardBtn.setAttribute("data-sub", sub.subId);
  addCardBtn.textContent = "Добавить";
  subDiv.appendChild(addCardBtn);

  // Вставляем подколонку в соответствующий контейнер
  subsContainer.appendChild(subDiv);

  // 4) Инициализируем SortableJS для нового container карточек
  new Sortable(cardsContainer, {
    group: "cards",
    animation: 150,
    ghostClass: "sortable-ghost",
    onEnd: async (evt) => {
      const cardElem = evt.item;
      const cardId = cardElem.getAttribute("data-id");

      // Находим новую колонку и подколонку
      const newColumn = evt.to.closest(".column");
      const newSubcolumn = evt.to.closest(".subcolumn");

      if (!newColumn || !newSubcolumn) {
        console.error("Не удалось найти целевую колонку или подколонку");
        return;
      }

      const newColumnId = newColumn.getAttribute("data-column");
      const newSubId = newSubcolumn.getAttribute("data-sub");

      await moveCardInDB(cardId, newColumnId, newSubId);
    },
  });

  // 5) Обработчик кнопки “+ Добавить карточку”
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
    const container = document.getElementById(`${card.columnId}-${card.subId}`);
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

  // Тип карточки
  if (card.type === "locomotive") {
    cardDiv.classList.add("card-locomotive");
  } else if (card.type === "engineer") {
    cardDiv.classList.add("card-engineer");
  } else if (card.type === "assistant") {
    cardDiv.classList.add("card-assistant");
  }

  cardDiv.setAttribute("data-type", card.type);
  cardDiv.setAttribute("data-id", card.id);

  const contentWrapper = document.createElement("div");
  contentWrapper.classList.add("card-content");

  if (card.photoUrl) {
    const img = document.createElement("img");
    img.src = card.photoUrl;
    img.alt = "Фото";
    img.classList.add("card-photo-side");
    contentWrapper.appendChild(img);
  }

  const textDiv = document.createElement("div");
  textDiv.classList.add("card-text");

  const h4 = document.createElement("h4");
  if (card.type === "locomotive") {
    h4.textContent = `Тепловоз: ${card.name}`;
  } else if (card.type === "engineer") {
    h4.textContent = `Машинист: ${card.name}`;
  } else if (card.type === "assistant") {
    h4.textContent = `Помощник: ${card.name}`;
  }
  textDiv.appendChild(h4);

  if (card.type === "locomotive") {
    const pCode = document.createElement("p");
    pCode.innerHTML = `<strong>Код:</strong> ${card.code}`;
    textDiv.appendChild(pCode);
  } else {
    const pPos = document.createElement("p");
    pPos.innerHTML = `<strong>Позиция:</strong> ${card.position}`;
    const pCode = document.createElement("p");
    pCode.innerHTML = `<strong>Код:</strong> ${card.code}`;
    textDiv.append(pPos, pCode);
  }

  contentWrapper.appendChild(textDiv);
  cardDiv.appendChild(contentWrapper);

  const actions = document.createElement("div");
  actions.classList.add("card-actions");
  const editBtn = document.createElement("button");
  editBtn.classList.add("edit-btn");
  editBtn.textContent = "✏️";
  const delBtn = document.createElement("button");
  delBtn.classList.add("delete-btn");
  delBtn.textContent = "🗑️";
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
  const position = prompt("Позиция машиниста:");
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
  const id = cardElem.getAttribute("data-id");

  const tx = db.transaction("cards", "readonly");
  const store = tx.objectStore("cards");
  const getReq = store.get(id);
  getReq.onsuccess = function () {
    const card = getReq.result;
    if (!card) return;

    if (card.type === "locomotive") {
      const newName = prompt("Новое название тепловоза:", card.name);
      if (!newName) return;
      const newCode = prompt("Новый код тепловоза:", card.code);
      if (!newCode) return;
      const newPhoto = prompt("Новая ссылка на фото:", card.photoUrl || "");
      card.photoUrl = newPhoto;

      card.name = newName;
      card.code = newCode;
      updateCardInDB(card).then(() => {
        // Обновляем DOM после сохранения
        cardElem.querySelector("h4").textContent = `Тепловоз: ${newName}`;
        const pCode = cardElem.querySelector("p");
        pCode.innerHTML = `<strong>Код:</strong> ${newCode}`;
        updateCardPhoto(cardElem, newPhoto);
      });
    } else {
      const newPosition = prompt(
        card.type === "assistant"
          ? "Новая позиция помощника:"
          : "Новая позиция машиниста:",
        card.position
      );
      if (!newPosition) return;
      const newName = prompt(
        card.type === "assistant"
          ? "Новое ФИО помощника:"
          : "Новое ФИО машиниста:",
        card.name
      );
      if (!newName) return;
      const newCode = prompt(
        card.type === "assistant"
          ? "Новый код помощника:"
          : "Новый код машиниста:",
        card.code
      );
      if (!newCode) return;
      const newPhoto = prompt("Новая ссылка на фото:", card.photoUrl || "");
      card.photoUrl = newPhoto;

      card.position = newPosition;
      card.name = newName;
      card.code = newCode;
      updateCardInDB(card).then(() => {
        // Обновляем DOM после сохранения
        const role = card.type === "assistant" ? "Помощник" : "Машинист";
        cardElem.querySelector("h4").textContent = `${role}: ${newName}`;
        const [pPos, pCode] = cardElem.querySelectorAll("p");
        pPos.innerHTML = `<strong>Позиция:</strong> ${newPosition}`;
        pCode.innerHTML = `<strong>Код:</strong> ${newCode}`;
        updateCardPhoto(cardElem, newPhoto);
      });
    }
  };
}
function updateColumnOrder(columnsOrder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("columns", "readwrite");
    const store = tx.objectStore("columns");

    columnsOrder.forEach((columnId, index) => {
      const request = store.get(columnId);
      request.onsuccess = () => {
        const column = request.result;
        if (column) {
          column.order = index;
          store.put(column);
        }
      };
    });

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
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
function updateCardPhoto(cardElem, newPhoto) {
  const contentWrapper = cardElem.querySelector(".card-content");
  const existingImg = cardElem.querySelector("img");
  if (newPhoto) {
    if (existingImg) {
      existingImg.src = newPhoto;
    } else {
      const img = document.createElement("img");
      img.src = newPhoto;
      img.alt = "Фото";
      img.classList.add("card-photo-side");
      contentWrapper.insertBefore(img, cardElem.querySelector(".card-text"));
    }
  } else if (existingImg) {
    existingImg.remove();
  }
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
  // 7) Инициализация перетаскивания колонок
  const board = document.getElementById("board");

  new Sortable(board, {
    group: "columns",
    animation: 200,
    handle: ".column-header",
    ghostClass: "sortable-ghost-column",
    onEnd: async (evt) => {
      // Получаем новый порядок колонок
      const columnsOrder = Array.from(board.children).map((col) =>
        col.getAttribute("data-column")
      );

      // Сохраняем порядок в IndexedDB
      await updateColumnOrder(columnsOrder);

      console.log("Порядок колонок сохранен", columnsOrder);
    },
  });
});
