# Matrix API 0.3.0

Все запросы идут через Rust SDK с текущей Matrix-сессией. SDK выбирает доступные версии endpoint; wiremock проверяет пути v3. Admin API Synapse и Telegram API не используются.

| Действие | Endpoint / событие |
|---|---|
| Вход, выход | POST /login, POST /logout |
| Обновления, история | GET /sync, GET /rooms/{id}/messages |
| Проверка E2EE | GET /rooms/{id}/state/m.room.encryption |
| Отправка | PUT /rooms/{id}/send/m.room.message/{txn} или SDK m.room.encrypted |
| Ответ, правка, реакция | m.in_reply_to, m.replace + m.new_content, m.reaction / m.annotation |
| Удаление | PUT /rooms/{id}/redact/{eventId}/{txn} |
| Поиск пользователей | POST /user_directory/search, search_term, limit=30 |
| Новый личный чат | POST /createRoom, is_direct=true, private_chat; m.direct account data |
| Новая комната, вступление | POST /createRoom; POST /join/{id} |
| Прочтение, набор | /receipt/m.read/{eventId}, /typing/{userId} |
| TURN | GET /voip/turnServer; UI вызова ещё отсутствует |
| Ключи E2EE | SDK /keys/upload, /keys/query, /keys/claim, /sendToDevice |
| Восстановление | SDK recovery.recover, secret storage и существующий backup |

Новый личный чат намеренно создаётся через create_room без encryption initial state: SDK create_dm по умолчанию добавляет E2EE, что не соответствует выбранному поведению приложения. Повторное открытие использует SDK m.direct и локальное соответствие, без дублирования комнаты.

Публичные модели IPC: SessionInfo, RoomSummary, TimelinePage, EncryptionStatus, UserSearchResult и ChatFolder. Поля camelCase. В моделях нет токена или пароля SDK store. Recovery key и пароль экспорта передаются только в явных командах пользователя и не возвращаются интерфейсу.

Папки — локальная SQLite настройка, без изменения Matrix комнат или удаления чатов. Поиск ограничен видимостью каталога, которую определяет Synapse. Форматированный HTML и вложения пока отображаются только текстовым body.
