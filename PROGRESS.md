# MatrixGram — прогресс 0.5.3

Дата: **11 ноября 2026**. Windows — основной клиент; Android — экспериментальная сборка. Наличие кода, подписи и автоматических тестов не означает проверки перехода между установленными версиями на устройстве.

## Исправления 0.5.3

- Имена и аватары из SDK передаются в одной IPC-странице с событиями; UI не показывает известного отправителя сначала логином. Профили и права хранятся по комнате и аккаунту, обновляются даже state-only sync. История запрашивает членство только для отправителей страницы; имена отсутствующих локально участников берутся из отдельного state в ответе `/messages`.
- При открытии убран `roomDetails`, включавший сетевую загрузку всего списка участников, закреплений и настроек. Свежая история повторно используется 60 секунд без повторного чтения SQLite; более поздний запрос обновляет уже видимую историю. После восстановления ключей свежесть сбрасывается. Резервная копия ключей запрашивается только при недостающих ключах; ожидание ограничено 10 секундами.
- Приглашения видны отдельной строкой независимо от выбранной папки, первыми в общем списке и в «Новых» даже с unread=0. Добавлены сведения о пригласившем, принятие/отклонение и уведомления без повторов на каждом sync. Приглашения после входа/переподключения не зависят от наличия сообщений в timeline.
- Проверены production frontend build, **37 unit-тестов**, **43 Playwright-сценария**, **2 Node release-tool теста**, policy и разбор workflow. Новый браузерный сценарий удерживает ответ history: имя видно до его завершения; шесть повторных открытий дают один запрос истории и ни одного `roomDetails`. Страницы с недостающими E2EE-ключами можно запросить повторно без ожидания 60 секунд.
- Прошли **42 Rust-теста** (37 core + 5 приложения), Clippy `--all-targets -D warnings`, fmt, 2 браузерных нагрузочных сценария и SQLite-нагрузка на 100 000 событий. Локальные браузерные нагрузочные цифры получены параллельно компиляции; это проверка порогов, не сравнение скорости с предыдущими версиями.
- Исходники: commit `1a291ef1ed0178bd45d1faba12649b050689a2eb`, tag `v0.5.3`. [Облачные проверки](https://github.com/VirusGrip/MatrixGram/actions/runs/43096188002), [tag release](https://github.com/VirusGrip/MatrixGram/actions/runs/43096374999) и [ручной повтор выпуска](https://github.com/VirusGrip/MatrixGram/actions/runs/43097515683) ещё в очереди GitHub, без назначенных jobs. API отмены tag run ответил HTTP 409 «has not been queued yet», хотя чтение показывает queued. Тег не перемещался. В публичном канале пока 0.5.2; новых опубликованных Android-пакетов нет.
- **Локальная Windows 0.5.3 собрана:** `releases/local-0.5.3/MatrixGram_0.5.3_x64-setup.exe`, portable `MatrixGram-0.5.3-windows-x64.exe`, `.sig`, SHA-256 и `BUILD-local-0.5.3.json`. Проверены minisign установщика с подписанной версией, x64 PE и FileVersion/ProductVersion 0.5.3. Это не артефакты GitHub Actions и не Authenticode. NSIS — 15 375 235 байт, SHA-256 `31060d4ff39f1e17852b0fd555220eca56aac3c1ba96f11b3d7d8fce62e2e0d4`.
- Source ZIP `MatrixGram-source-0.5.3.zip` сохранён рядом с проектом из тега; проверены CRC, версия и отсутствие файлов ключей/бинарников. SHA-256: `03661b812c7ac178e0501e6b03edbd4663502928cc260756bc48480c857dcaae`.
- Установка 0.5.2 → 0.5.3, реальные приглашения на Synapse пользователя и системные toast ещё не проверены. На Android в закрытом приложении фонового push нет. Не подменять эти ограничения результатами автоматических тестов.

## Подписанные обновления

- Настройки → Обновления MatrixGram: проверка GitHub Releases, скачивание, прогресс, проверка подписи и установка. До 0.5.2 updater отсутствовал; первую версию с ним устанавливают вручную.
- Windows: Tauri updater 2.14.1, обязательная подпись с привязкой версии, NSIS passive и restart. Сохраняется открытый черновик; звонок/активные отправки/ошибка сохранения блокируют установку.
- Android: HTTPS manifest и APK, minisign и подписанная версия, package ID/versionCode/сертификат установленного приложения, private-cache FileProvider и системное подтверждение. При запросе разрешения установки APK сохраняется для повторной попытки.
- Постоянный updater key создан вне Git, пароль локально защищён DPAPI. В GitHub Actions Secrets загружены шесть параметров подписи. Исходный Android keystore сохранён; сертификат совпадает с ранее выданным 0.5.1 APK.
- [VirusGrip/MatrixGram](https://github.com/VirusGrip/MatrixGram) выбран для исходников и Releases. Release workflow собирает обе платформы по тегу, подписывает, создаёт source ZIP/контрольные суммы/latest.json и публикует релиз. Ключи в исходники не включены. `set-version.mjs` согласованно обновляет manifests/lockfiles/UI.

## Проверки предыдущей версии 0.5.2

- **39 Rust tests**: 34 core и 5 приложения, включая настоящий minisign/tamper/подмену версии, stable-version/URL policy и прежние E2EE/SQLite/DPAPI/Matrix SDK сценарии. Отдельный SQLite load-тест сохранён как ignored по умолчанию.
- **27 frontend unit tests**, **40 Playwright-сценариев** с отдельным IPC. Новые сценарии: update check/download/install, ошибка подписи, сохранение черновика и отказ при ошибке, Android permission/retry и актуальная версия.
- **2 Node release-tool tests**: manifest обеих платформ с подписанной версией и bump версии без рассогласования. Три workflow разобраны YAML parser. Фактические CI-запуски указаны ниже.
- Production frontend build, policy check, Rust fmt и Clippy. Для test tooling Vitest обновлён до 4.1.12; npm audit при обновлении сообщил 0 известных уязвимостей.
- Подписание локальным зашифрованным ключом прошло preflight на существующем 0.5.1 installer; ошибочные подписи не включают установку в UI/native tests.

## Предыдущий выпуск 0.5.2

**0.5.2 опубликована 11 ноября 2026 в 16:54 UTC:** [релиз и исходники](https://github.com/VirusGrip/MatrixGram/releases/tag/v0.5.2).

- [Windows x64 installer](https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/MatrixGram_0.5.2_x64-setup.exe) — 15 399 517 байт.
- [Android arm64 release APK](https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/MatrixGram-0.5.2-android-arm64.apk) — 52 902 220 байт; Android 8+, versionCode 5002, target SDK 36.
- [Source ZIP](https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/MatrixGram-source-0.5.2.zip) — 493 995 байт; [SHA-256](https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/SHA256SUMS.txt).

[Подписанный release workflow](https://github.com/VirusGrip/MatrixGram/actions/runs/43059181981) успешно выполнил Windows, Android и publish jobs. [Основной Windows workflow](https://github.com/VirusGrip/MatrixGram/actions/runs/43053375856) прошёл функциональные проверки, fmt, Clippy, policy и отдельные нагрузочные сценарии браузера/SQLite. В browser IPC-нагрузке: 5 000 комнат, 60 000 событий, CPU ×4; sync median 167,3 мс / p95 184,3 мс, поиск 145,1 мс. Это отдельный облачный стенд, не замер native клиента или телефона и не сравнение со стендом 0.5.1.

Скачанные из опубликованного релиза файлы независимо проверены: SHA-256, minisign обоих пакетов и подписанная версия; APK v2 и исходный сертификат 0.5.1, package ID/versionCode, arm64 ELF/JNI/TLS/update provider; CRC и конфигурация source ZIP. Публичный `releases/latest/download/latest.json` без авторизации вернул HTTP 200, версию 0.5.2 и обе платформы. Windows-подпись updater не является Authenticode-сертификатом.

Исходники пакетов: tag `v0.5.2`, commit `2cf14903a263d8cc9f52a7e5aa7bbd10c3dcccfa`. Первый выпуск запущен вручную с этим тегом и workflow из `382d38fca50fc3cf60bd5760ef2373e553beee6b`: в main исправлены подготовка Android SDK и абсолютный путь к APK для signer. Тег не перемещался. Source ZIP отражает снимок тега; этот итог выпуска записан в main отдельно.

Локальные копии официальных пакетов, `.sig`, manifest, контрольных сумм и `BUILD-0.5.2.json` сохранены в `releases/`; source ZIP — рядом с проектом. Старые версии сохранены. Первую установку 0.5.2 выполняют вручную, затем новые версии проверяются через Настройки → Обновления MatrixGram. Переход между установленными версиями на Windows и Android ещё не проверен.

## Сохранённые функции и ограничения

Сохранены оформление по примеру Telegram, ПАПКИ, поиск пользователей, необязательное E2EE/recovery/import/export, расшифрованное превью в памяти, аватары DM, локальные подписи, закрепление чатов, выбор/пересылка до 100 сообщений, медиа/голосовые, профили/аккаунты, 1:1 WebRTC. [Замеры оптимизации 0.5.1](docs/PERFORMANCE.md) остаются историческим измерением; не выдаются за новые native/Android-замеры 0.5.2. Synapse, PostgreSQL и TURN не менялись.

Переход 0.5.2 → следующая версия в реальном Windows installer и на Android пока не проверялся. Android HTTPS/Keystore/permissions/lifecycle и звонки на телефоне также требуют проверки. Нет фонового push/foreground call service, SAS/QR, UI создания новой backup, OIDC/SSO, групповых MatrixRTC, синхронизации папок/подписей, durable outbox/resumable upload и Authenticode. Неактивные аккаунты не синхронизируются одновременно. Декодированная E2EE-история не пишется в открытый UI cache, обычный кеш сохраняется после logout; безопасного стирания нет.

Документация: [обновления](docs/UPDATES.md), [проверки](docs/TESTING.md), [безопасность](docs/SECURITY.md), [Windows](docs/BUILD_WINDOWS.md), [Android](docs/BUILD_ANDROID.md), [план](docs/ROADMAP.md).
