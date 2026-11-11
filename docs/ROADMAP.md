# Состояние после расширения 0.5.2

Историческое ТЗ — original-spec.ru.md. Актуальные пожелания пользователя имеют приоритет: необязательное E2EE, поиск по отображаемому имени, ПАПКИ и оформление по примеру Telegram. Серверная инфраструктура не менялась.

| Область | Реализовано в исходниках | Остаётся |
|---|---|---|
| UI | нагрузочные сценарии и кеш проекции, индексы/мемоизация, компактная раскладка, темы, группы сообщений, resize, масштаб, фоны | проверка на разных WebView2 и экранах |
| Вход | пароль, DPAPI/Keystore, restore/logout, до 10 профилей, переключение | SSO/OIDC, одновременный sync неактивных аккаунтов |
| E2EE | опциональное включение, SDK crypto, превью в памяти, recovery, импорт/экспорт ключей, выбор при создании | SAS/QR, UI создания backup, реальный обмен/доверие с Element |
| Люди | каталог, DM с фото собеседника, личные подписи на устройстве, профиль, ignore/unignore | отдельная адресная книга, управление списком заблокированных |
| ПАПКИ | названия/состав/unread-only/порядок/редактирование/удаление | синхронизация между устройствами |
| Текст | sync, история, retry, ответ, правка, redaction, реакции, Markdown, mentions, массовая пересылка с partial retry, контекстное закрепление чата/pin, typing/receipts | durable outbox, scheduled send, poll/thread UI, поиск всей E2EE-истории |
| Комнаты | private/public, каналы, участники, роли, invite/kick/ban, настройки, каталог/join/leave | гибкий редактор power levels, список банов/unban UI, пространства Matrix |
| Медиа | upload/download/preview/save, голосовые, прогресс/отмена/retry | resumable upload, альбомы, стикеры/GIF, транскрипция |
| Звонки | Matrix VoIP v1 1:1, WebRTC, TURN discovery, устройства/экран | проверка реального TURN и Element, group MatrixRTC, push входящего вызова |
| Windows | EXE/NSIS, signed updater, GitHub release workflow, tray/autostart/notifications | проверка перехода между версиями, чистые Windows 10/11, Authenticode |
| Android | общий клиент, Keystore/JNI TLS, APK updater, Back/share/permissions/save | runtime на телефоне, lifecycle/фон, push/foreground service, release signing |

Первым следует проверить новый клиент на отдельном тестовом аккаунте с Element: обычные/E2EE вложения и ключи, затем звонки через relay-only TURN. Далее — чистая установка Windows и Android на устройстве. Тестовый IPC и локальные WebRTC peers этих проверок не заменяют.
