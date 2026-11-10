# MatrixGram — прогресс 0.4.0

Дата: **10 ноября 2026**. Ранняя сборка Windows; Android — экспериментальная ветка того же клиента. «Реализовано» ниже означает наличие кода и перечисленных локальных проверок, а не подтверждение всех сценариев на реальном сервере.

## Что добавлено

- Отправка/просмотр/сохранение фото, видео, аудио и файлов до 25 МБ; авторизованный download и E2EE attachments через SDK. Есть drag-and-drop/вставка, очередь из двух отправителей, прогресс, отмена/retry; отправка файлов продолжается при смене чата.
- Голосовые с реальным микрофоном/MediaRecorder, длительностью, индикатором уровня, паузой, продолжением, отменой, воспроизведением/перемоткой и сохранением.
- Профили и аватары, своё имя/фото, блокировка/разблокировка; участники/поиск/приглашения/роли/kick/ban, название/описание/фото комнаты, выход.
- Каналы на стандартных Matrix power levels, каталог публичных комнат и join по ID/alias/matrix.to.
- Пересылка, pins, Markdown/безопасный HTML, mentions, typing/read receipt, серверный поиск по обычной истории с переходом к результату. Поиск E2EE ограничен загруженными сообщениями.
- Сохранённые аккаунты и переключение с очисткой переписки/медиа и отменой загрузок; profile UUID isolation и совместимость с legacy. Список устройств, переименование/отзыв другой сессии с UIA-паролем сервера.
- Native notifications, звук, room mute, Windows tray/autostart, масштаб 85–125% и фоны. Закрытие окна завершает приложение; «Свернуть в трей» оставляет sync активным.
- Matrix VoIP v1 + настоящий WebRTC 1:1: audio/video, mute, устройства, длительность и screen share, когда API доступен. Используется существующий TURN через Matrix endpoint.
- Android: исходники Keystore/JNI TLS, разрешений, Back/share/document save. Собран arm64 debug APK, проверены manifest/ABI и тестовая подпись. Установка, запуск, HTTPS и Keystore на телефоне/эмуляторе не проверялись; Android остаётся экспериментальным.

## Ключи и ПАПКИ

Сохранены поиск по имени/фамилии и **ПАПКИ**. «Открыть зашифрованные комнаты» остаётся сбоку; при входе ключи не навязываются. Новые комнаты/DM обычные по умолчанию, E2EE выбирается явно. Поддержаны recovery существующего хранилища, импорт и зашифрованный экспорт SDK-ключей. Автоматический bootstrap backup/cross-signing отключён. Конфигурация Synapse, PostgreSQL, TURN и служб **не менялась**.

## Проверено локально

- **35 Rust tests**: 33 core и 2 каталога профилей. Настоящий SDK работает с wiremock; проверены шифрование файла/события, encrypted media decryption/integrity, authenticated download, stable txn, channel powers, UIA, mentions/edit/forward и room links. Защита Windows DPAPI/SDK store проверена автоматически.
- **14 frontend unit tests** и **28 Playwright-сценариев** с отдельным тестовым IPC. Есть настоящий MediaRecorder и проигрываемые аудиобайты, safe HTML, фоновые загрузки/отмена, поиск, профили/аккаунты, ошибки после switch, read-only channel, share/Back, масштаб и виртуализация.
- Два настоящих WebRTC peer обменялись RTP; проверены mute/остановка tracks и отложенный invite после dispose. TURN и Matrix-сигнальный транспорт в этом сценарии заменены тестовым адаптером.
- Frontend production build, cargo fmt, Clippy --workspace --all-targets --locked -D warnings, check:policy. В production bundle нет тестового IPC/данных.
- Windows x64 EXE/NSIS собраны; PE version, встроенные frontend assets и SHA-256 сверены. Установка/удаление и запуск этой версии в реальном аккаунте не выполнялись.

Тесты не использовали пароль, recovery key, TURN credentials или переписки пользователя. Снимки интерфейса используют вымышленные данные.

## Артефакты

| Файл | Размер |
|---|---|
| [MatrixGram-0.4.0-windows-x64.exe](releases/MatrixGram-0.4.0-windows-x64.exe) | 70,818,304 байт |
| [MatrixGram_0.4.0_x64-setup.exe](releases/MatrixGram_0.4.0_x64-setup.exe) | 15,152,293 байт |
| [MatrixGram-0.4.0-android-arm64-debug.apk](releases/MatrixGram-0.4.0-android-arm64-debug.apk) | 168,443,907 байт |

[SHA-256](releases/SHA256SUMS-0.4.0.txt). Windows без цифровой подписи. Android APK, если указан в таблице, подписан тестовым debug-сертификатом.

Исходники отдельно: **MatrixGram-source-0.4.0.zip**. Старые EXE/установщики и исходники 0.1–0.3 сохранены. Локальный Git обновлён; на GitHub ничего не публиковалось.

[Тёмная тема](releases/MatrixGram-0.4.0-desktop-preview.png), [светлая](releases/MatrixGram-0.4.0-light-preview.png), [мобильная раскладка в браузере](releases/MatrixGram-0.4.0-mobile-preview.png).

## Что остаётся

- Реальные Synapse/Element recovery и E2EE interoperability, TURN/NAT/relay-only, video/screen/device switching, системные уведомления, tray/autostart и installer/update на чистых Windows 10/11 требуют проверки на тестовых аккаунтах/устройствах.
- Собран arm64 debug APK, проверены manifest/ABI и тестовая подпись. Установка, запуск, HTTPS и Keystore на телефоне/эмуляторе не проверялись; Android остаётся экспериментальным. Нет push gateway/FCM/UnifiedPush и Android foreground call service. В закрытом/усыплённом приложении уведомления и звонки не гарантируются. Production signing keystore не создан.
- Нет SSO/OIDC, SAS/QR-верификации, UI создания новой серверной резервной копии, групповых MatrixRTC-вызовов и синхронизации папок. Неактивные аккаунты не синхронизируются одновременно.
- Нет durable outbox/resumable upload, сохранения позиции каждой переписки между открытиями, полноценного waveform готового голосового и Telegram-подобных жестов записи. Список ban/unban, гибкие power levels, missed-call history и отдельные уведомления о пропущенных вызовах ещё требуют доработки. Медиа-галерея показывает загруженную историю.
- Обычный SQLite-кеш сохраняется открытым после выхода; безопасного стирания нет. Отмена upload не откатывает уже принятый сервером event/media. Подробности — SECURITY.md.

Документация: [проверки](docs/TESTING.md), [план](docs/ROADMAP.md), [безопасность](docs/SECURITY.md), [архитектура](docs/ARCHITECTURE.md), [звонки](docs/CALLS.md), [Android](docs/BUILD_ANDROID.md).
