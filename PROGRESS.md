# MatrixGram — прогресс 0.5.2

Дата: **11 ноября 2026**. Windows — основной клиент; Android — экспериментальная сборка. Наличие кода, подписи и автоматических тестов не означает проверки перехода между установленными версиями на устройстве.

## Подписанные обновления

- Настройки → Обновления MatrixGram: проверка GitHub Releases, скачивание, прогресс, проверка подписи и установка. До 0.5.2 updater отсутствовал; первую версию с ним устанавливают вручную.
- Windows: Tauri updater 2.14.1, обязательная подпись с привязкой версии, NSIS passive и restart. Сохраняется открытый черновик; звонок/активные отправки/ошибка сохранения блокируют установку.
- Android: HTTPS manifest и APK, minisign и подписанная версия, package ID/versionCode/сертификат установленного приложения, private-cache FileProvider и системное подтверждение. При запросе разрешения установки APK сохраняется для повторной попытки.
- Постоянный updater key создан вне Git, пароль локально защищён DPAPI. В GitHub Actions Secrets загружены шесть параметров подписи. Исходный Android keystore сохранён; сертификат совпадает с ранее выданным 0.5.1 APK.
- [VirusGrip/MatrixGram](https://github.com/VirusGrip/MatrixGram) выбран для исходников и Releases. Release workflow собирает обе платформы по тегу, подписывает, создаёт source ZIP/контрольные суммы/latest.json и публикует релиз. Ключи в исходники не включены. `set-version.mjs` согласованно обновляет manifests/lockfiles/UI.

## Проверено локально

- **39 Rust tests**: 34 core и 5 приложения, включая настоящий minisign/tamper/подмену версии, stable-version/URL policy и прежние E2EE/SQLite/DPAPI/Matrix SDK сценарии. Отдельный SQLite load-тест сохранён как ignored по умолчанию.
- **27 frontend unit tests**, **40 Playwright-сценариев** с отдельным IPC. Новые сценарии: update check/download/install, ошибка подписи, сохранение черновика и отказ при ошибке, Android permission/retry и актуальная версия.
- **2 Node release-tool tests**: manifest обеих платформ с подписанной версией и bump версии без рассогласования. Три workflow разобраны YAML parser. Фактический CI-запуск будет указан ниже после завершения.
- Production frontend build, policy check, Rust fmt и Clippy. Для test tooling Vitest обновлён до 4.1.12; npm audit при обновлении сообщил 0 известных уязвимостей.
- Подписание локальным зашифрованным ключом прошло preflight на существующем 0.5.1 installer; ошибочные подписи не включают установку в UI/native tests.

## Статус выпуска

Локальные Windows EXE/NSIS с updater signature и Android debug APK 0.5.2 собраны. В исходниках настроены постоянные ключи для release CI. Первый запуск GitHub release workflow и публикация артефактов выполняются; актуальный итог фиксируется в этой секции после завершения. Официальные пакеты будут доступны в [Releases](https://github.com/VirusGrip/MatrixGram/releases).

## Сохранённые функции и ограничения

Сохранены оформление по примеру Telegram, ПАПКИ, поиск пользователей, необязательное E2EE/recovery/import/export, расшифрованное превью в памяти, аватары DM, локальные подписи, закрепление чатов, выбор/пересылка до 100 сообщений, медиа/голосовые, профили/аккаунты, 1:1 WebRTC. [Замеры оптимизации 0.5.1](docs/PERFORMANCE.md) остаются историческим измерением; не выдаются за новые native/Android-замеры 0.5.2. Synapse, PostgreSQL и TURN не менялись.

Переход 0.5.2 → следующая версия в реальном Windows installer и на Android пока не проверялся. Android HTTPS/Keystore/permissions/lifecycle и звонки на телефоне также требуют проверки. Нет фонового push/foreground call service, SAS/QR, UI создания новой backup, OIDC/SSO, групповых MatrixRTC, синхронизации папок/подписей, durable outbox/resumable upload и Authenticode. Неактивные аккаунты не синхронизируются одновременно. Декодированная E2EE-история не пишется в открытый UI cache, обычный кеш сохраняется после logout; безопасного стирания нет.

Документация: [обновления](docs/UPDATES.md), [проверки](docs/TESTING.md), [безопасность](docs/SECURITY.md), [Windows](docs/BUILD_WINDOWS.md), [Android](docs/BUILD_ANDROID.md), [план](docs/ROADMAP.md).
