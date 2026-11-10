# Matrix API 0.4.0

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
| TURN | GET /voip/turnServer; Matrix VoIP v1 room events |
| Ключи E2EE | SDK /keys/upload, /keys/query, /keys/claim, /sendToDevice |
| Восстановление | SDK recovery.recover, secret storage и существующий backup |

Новый личный чат намеренно создаётся через create_room без encryption initial state: SDK create_dm по умолчанию добавляет E2EE, что не соответствует выбранному поведению приложения. Повторное открытие использует SDK m.direct и локальное соответствие, без дублирования комнаты.

Публичные модели IPC: SessionInfo, RoomSummary, TimelinePage, EncryptionStatus, UserSearchResult и ChatFolder. Поля camelCase. В моделях нет токена или пароля SDK store. Recovery key и пароль экспорта передаются только в явных командах пользователя и не возвращаются интерфейсу.

Папки — локальная SQLite настройка, без изменения Matrix комнат или удаления чатов. Поиск ограничен видимостью каталога, которую определяет Synapse. Форматированный HTML проходит белый список React-рендерера; вложения скачиваются авторизованно через SDK, включая encrypted file decryption.


Дополнительный IPC client_operation использует tagged enum kind/camelCase и передаёт только нужные параметры. Варианты покрывают profile/setProfile, roomDetails/roomSettings/member/leave/pin/readBy/notifications/ignore, devices/deviceName/removeDevice, publicRooms/join/createRoom, search/event/formatted/forward/call/turn/exportKeys. Отдельные команды upload_file/fetch_media/save_download и matrix-transfer обслуживают медиа. upload_file принимает ожидаемый sessionKey, чтобы не отправить файл от имени другого аккаунта.

| Действие | SDK endpoint / событие |
|---|---|
| Профиль | /profile/{userId}, /displayname, /avatar_url |
| Медиа | /media upload, authenticated /client/v1/media/download |
| Участники/права | /members, /invite, /kick, /ban, /unban, m.room.power_levels |
| Pins / настройки | m.room.pinned_events, m.room.name/topic/avatar |
| Устройства | /devices, /delete_devices с UIA |
| Ignore | m.ignored_user_list account data |
| Каталог / поиск | /publicRooms, /search room_events |
| Уведомления | /pushrules через SDK NotificationSettings |
| Вызов | m.call.invite/answer/candidates/hangup/reject/select_answer/negotiate |

Админских endpoint сервера нет. Ключи crypto-store экспортируются SDK только в зашифрованном формате; ни каталог аккаунтов, ни список устройств не содержат access token.
