# Интеграция Matrix API

Сетевые вызовы выполняет Matrix Rust SDK 0.19.1. SDK выбирает доступную версию endpoint по возможностям сервера; в тестовом сервере используются пути `/_matrix/client/v3`. Приложение не использует Telegram API и не обращается к Admin API Synapse.

| Действие | Matrix API / событие | Реализация |
|---|---|---|
| Вход | POST `/login`, `m.login.password` | `Account::login` |
| Возврат сессии | SDK `matrix_auth.restore_session`, тот же SQLite store | `Account::restore` |
| Обновления | GET `/sync`, since/timeout | `Account::sync_once` |
| История | GET `/rooms/{id}/messages`, dir=b, limit=50, from | `Account::history` |
| Контроль E2EE | GET `/rooms/{id}/state/m.room.encryption` | `Account::writable_room` |
| Текст и ответ | PUT `/rooms/{id}/send/m.room.message/{txn}`, `m.in_reply_to` | `Account::send_text` |
| Изменение | `m.room.message`, `m.replace` + `m.new_content` | `Account::edit` |
| Реакция | `m.reaction`, `m.annotation` | `Account::react` |
| Удаление | PUT `/rooms/{id}/redact/{eventId}/{txn}` | `Account::redact` |
| Новая комната | POST `/createRoom`, private_chat/public_chat | `Account::create_room` |
| Приглашение | invite в createRoom | создание комнаты |
| Вступление | POST `/join/{roomId}` | `Account::join` |
| Прочтение | POST `/rooms/{id}/receipt/m.read/{eventId}` | `Account::read` |
| Набор текста | PUT `/rooms/{id}/typing/{userId}` | Tauri `typing` |
| TURN | GET `/voip/turnServer` | Rust `turn_servers`; интерфейс вызова ещё отсутствует |
| Выход | POST `/logout` | `Account::logout` |

Публичные модели интерфейса: `SessionInfo`, `RoomSummary`, `TimelinePage`, `Update`. Имена полей IPC — camelCase. Токен доступа отсутствует во всех моделях UI. Состояние темы и закрепление чатов локальны; они не изменяют account data другого Matrix-клиента.

Текст не конвертируется в произвольный HTML. Вложенные `formatted_body` и медиа пока получают текстовое представление `body`. Реакции объединяются по event ID, ключу и отправителю; удаление реакции в UI ещё не реализовано. Галочка сообщения подтверждает наличие события в истории, а не прочтение другим участником.
