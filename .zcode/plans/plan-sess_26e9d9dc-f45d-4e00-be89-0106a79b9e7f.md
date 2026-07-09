## План: мобильная и планшетная версии

**Решения зафиксированы:**
- Планшет (721–1050px): sidebar слева + чат справа; галерея — off-canvas drawer по кнопке.
- Вкладка «Галерея» независима от режима «Картинки» (кнопка в композере).
- CSS: оставить 2 файла, media-запросы рядом с правилом компонента.
- Минимум ширины: 380px.
- Управление видимостью: CSS-only через `data-view="chats|chat|gallery"` на `.app-shell`.

---

### 1. `index.php` — разметка
- **Мобильный таб-бар** перед `.app-shell` (только мобильный, скрыт через CSS на остальных):
  ```html
  <nav class="mobile-tabs" data-mobile-tabs hidden>
    <button class="mobile-tab" data-mobile-tab="chats">Чаты</button>
    <button class="mobile-tab is-active" data-mobile-tab="chat">Чат</button>
    <button class="mobile-tab" data-mobile-tab="gallery">Галерея</button>
  </nav>
  ```
- Атрибут `data-view="chat"` на `.app-shell` (по умолчанию).
- **Кнопка галереи для планшета** в `.topbar-actions`:
  ```html
  <button type="button" class="icon-button" data-toggle-gallery title="Галерея" hidden>▦</button>
  ```
- Подключить `assets/mobile.js` после `layout.js`.

### 2. `assets/app.css` + `assets/app-ui.css` — адаптив

**Мобильный (`≤720px`):**
- `body` → flex column; `.mobile-tabs` → sticky сверху, 3 равные вкладки (~52px).
- `.app-shell` → `display:block`.
- Переключение панелей через `[data-view]`: chats→показать `.sidebar`; chat→`.chat-panel`; gallery→`.gallery-panel`. Остальные скрыты. Заменить старое `display:none` для sidebar/gallery.
- **Заголовок во всю ширину:** `.topbar` → `flex-direction:column`, heading на всю ширину, actions переносятся ниже (wrap), кнопки компактнее.
- **Фикс горизонтального обрезания:** `min-width:0` в цепочке `.chat-panel→.messages→.message→.bubble→.message-markdown`; `pre[class*=language-]` и таблицы — `overflow-x:auto` в обёртке, `max-width:100%`.
- **Композер:** `.quick-controls` горизонтальный скролл; `.ratio-picker` flex с горизонтальным скроллом; primary-button ~48px.
- **Модалка:** `.modal-card` на всю ширину, кнопки в footer переносятся, навигация ‹/› крупнее.

**Планшет (`721–1050px`):**
- `.app-shell` → `grid-template-columns: 280px minmax(0,1fr)` (sidebar + chat), **убрать** gallery снизу (`grid-row:2`).
- `.gallery-panel` → off-canvas drawer справа: `position:fixed; right:0; height:100dvh; width:min(440px,100%); transform:translateX(100%)`; при классе `.is-gallery-open` → `transform:none`. Подложка затемнения по клику вне.

### 3. Новый `assets/mobile.js` — `window.ChatMobile`
- `init()` — обработчики на табы и `data-toggle-gallery`.
- `setView(name)` — `app-shell.dataset.view=name`, класс `.is-active` на табе. No-op вне мобильного.
- `openGallery/closeGallery/toggleGallery()` — класс `.is-gallery-open` (планшет).
- `isMobile()/isTablet()` через `matchMedia`.
- Активную вкладку хранить в `localStorage` (`darktech-gpt.mobileView`, опционально).
- Таб «Галерея» на планшете → `openGallery()` (drawer, таб-бар скрыт); клик по затемнению → `closeGallery()`.

### 4. `assets/app.js` — интеграция
- В `bindApp()` → `window.ChatMobile && window.ChatMobile.init()`.
- В `openChat()` (успешная загрузка) и `createChatFromButton()` → `ChatMobile.setView('chat')` (авто-переход со вкладки «Чаты»).
- `renderMode()`: на мобильном больше **не** управляет показом gallery через grid — только композером (`data-image-controls`). Показ gallery на мобильном/планшете — через `data-view`/drawer. Десктоп оставить как есть.

### Результат
- ✅ Боковые панели (чаты/галерея) на мобильном через 3 вкладки.
- ✅ Заголовок чата во всю ширину.
- ✅ Содержимое чата не обрезается (скролл внутри pre/таблиц).
- ✅ Все элементы адаптированы под ≥380px.
- ✅ Планшет: sidebar + чат рядом, галерея по кнопке.

### Файлы
1. `index.php` — таб-бар, `data-view`, кнопка gallery, `mobile.js`.
2. `assets/app.css` — body flex, topbar, фикс обрезания, медиа-запросы.
3. `assets/app-ui.css` — таб-бар, композер/ratio-picker, gallery drawer, модалка.
4. `assets/mobile.js` — новый модуль.
5. `assets/app.js` — интеграция `ChatMobile`, отвязка gallery от `is-image-mode` на мобильном.