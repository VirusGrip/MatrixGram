# Обновления MatrixGram

Источник: [VirusGrip/MatrixGram Releases](https://github.com/VirusGrip/MatrixGram/releases). Manifest: `https://github.com/VirusGrip/MatrixGram/releases/latest/download/latest.json`.

Сборка каждой новой версии остаётся необходимой. Теперь её выполняет GitHub Actions по тегу, а пользователь скачивает и устанавливает обновление из приложения. Удалённая подмена JS или Rust без проверки пакета не используется.

## Для пользователей

Версии до 0.5.2 не содержат updater: первую 0.5.2 нужно установить вручную. Затем: Настройки → Обновления MatrixGram → Проверить → Скачать → Установить. Приложение проверяет подпись и версию пакета. Восстановление ключей E2EE не требуется заново только ради обновления; каталог данных и идентификатор приложения сохраняются.

Windows запускает NSIS в passive mode и перезапускается. Перед установкой сохраняется открытый черновик; активный звонок или отправка файлов блокируют установку. При ошибке сохранения черновика установщик не запускается. После неудачного запуска установщика можно повторно проверить и скачать пакет.

Android скачивает подписанный APK, затем проверяет package ID, увеличение versionCode и совпадение сертификата с установленным приложением. Системное окно требует подтверждения пользователя. Если Android запрещает установку из этого источника, приложение открывает соответствующую настройку; после разрешения нужно вернуться и ещё раз нажать «Установить». Проверенный APK остаётся в private cache. После отказа в системном установщике также можно повторить установку. На устройстве этот переход ещё требует проверки.

Проверка запускается явно, обновления не навязываются. Если канал недоступен, проверка сообщает об ошибке, а не утверждает, что версия актуальна.

## Релиз одной командой CI

После внесения и коммита изменений кода:

```powershell
node scripts/set-version.mjs 0.5.4
npm test
git add package.json package-lock.json Cargo.toml Cargo.lock apps/client/package.json apps/client/src-tauri/tauri.conf.json apps/client/src/App.tsx
git commit -m "Release 0.5.4"
git tag v0.5.4
git push --atomic origin main v0.5.4
```

`set-version` обновляет npm/Cargo/Tauri manifests, собственные записи lockfiles и номер в UI. Неизвестные версии, понижение и рассогласованные исходные версии отклоняются. Номер не нужно менять в нескольких файлах вручную.

Описание изменений можно записать в `release-notes/VERSION.md` и включить в тот же commit. Release workflow использует его для страницы релиза и поля notes в `latest.json`; этот текст будет виден в настройках перед обновлением.

`.github/workflows/release.yml` собирает Windows x64 и Android arm64, использует постоянные ключи, создаёт `.sig` и `latest.json`, добавляет source ZIP и SHA-256. Релиз сначала создаётся как draft; после наличия обоих пакетов публикуется и становится latest. Повторное использование уже опубликованного номера не заменяет его файлы автоматически: исправление выпускается новым номером. Ручной повтор доступен через Actions → Signed MatrixGram release → Run workflow с существующим тегом.

Обычный Windows workflow выполняет функциональные и нагрузочные проверки. Сборка unsigned preview доступна через ручной workflow_dispatch; основной подписанный установщик собирается release workflow, чтобы не выполнять лишнюю релизную линковку на каждом commit.

Если прежний запуск застрял до создания jobs и GitHub не отменяет его даже через API, ручной `recovery=true` использует отдельную concurrency group. Обычные запуски сохраняют группу по тегу. Например: `gh workflow run release.yml --ref main -f tag=v0.5.3 -f recovery=true`. Существующий опубликованный релиз по-прежнему не перезаписывается. `.github/workflows/actions-diagnostic.yml` вручную проверяет старт Linux/Windows без checkout, исходников, сторонних actions и Secrets. Эти обходы не устраняют сбой инфраструктуры GitHub.

## Ключи и однократная настройка

Публичный updater key находится в `src-tauri/updates.json` и `tauri.conf.json`. Windows использует Tauri updater 2.14.1 с `requireSignedVersion=true`; Android проверяет тот же формат minisign, включая подписанную версию. Проверяются только новые stable SemVer. URL пакета ограничен выбранным репозиторием и тегом. Запросы выполняются в Rust по HTTPS; токены GitHub в клиент не встроены.

Локальный Windows helper `scripts/init-update-signing.ps1` создаёт ключ один раз в `%LOCALAPPDATA%/MatrixGramReleaseSigning`. Ключ зашифрован случайным паролем, пароль защищён DPAPI этого пользователя Windows. Существующий ключ не перезаписывается. `scripts/update-signing-env.ps1` временно передаёт материал подписи Tauri через environment; build script восстанавливает прежние значения. Каталог нужно сохранить отдельно от Git. DPAPI-файл привязан к текущему Windows-профилю: копии каталога недостаточно для восстановления на другом компьютере. Для переносимого резервного восстановления нужны зашифрованный private key и его пароль, сохранённый отдельно в менеджере паролей. GitHub Secrets не позволяют прочитать загруженное значение обратно. Потеря ключа требует ручной миграции установленных клиентов.

Для GitHub Actions нужны Secrets:

- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

`scripts/connect-github-updates.ps1` отправляет их через авторизованный GitHub CLI по stdin, без вывода значений и без записи в исходники. Для текущего проекта используется VirusGrip/MatrixGram. Подключение Codex GitHub позволяет читать/менять код, но его доступные инструменты не предоставляют API настройки Actions Secrets: для этой однократной операции применён официальный GitHub CLI с отдельной авторизацией пользователя.

Подпись Android должна оставаться той же, что у ранее установленных APK. Для текущих тестовых установок сохранён исходный debug keystore; сертификат сверен с 0.5.1 APK. Release-сборка CI использует этот постоянный ключ, не случайный debug keystore нового runner. Это не подпись для публикации в Google Play. Сменять ключ или заставлять пользователей удалять приложение ради обновления автоматически нельзя: это может лишить доступа к локальному Keystore и E2EE-ключам.

Android APK ограничен 256 МиБ, JSON manifest — 512 КиБ. APK загружается в Rust без передачи base64 через WebView, проверяется и помещается в private cache. Отображение прогресса ограничено примерно 10 событиями в секунду. Подпись APK дополнительно проверяется Android. Подписанные release-файлы не означают наличие Windows Authenticode-сертификата.

## Что проверено

Rust-тесты проверяют настоящий minisign: корректную подпись, повреждение payload, неверную подпись, замену подписанной версии, запрет понижения/prerelease и адресов чужого репозитория. Browser IPC-тесты проверяют проверку/скачивание/установку, отказ после ошибки подписи и сохранения черновика, актуальную версию и повтор после запроса разрешения Android. Node-тесты проверяют manifest обоих пакетов и согласованность bump версии. Это не заменяет реальный переход 0.5.2 → 0.5.3 на Windows и Android.

Первый выпуск [0.5.2](https://github.com/VirusGrip/MatrixGram/releases/tag/v0.5.2) опубликован; [release workflow](https://github.com/VirusGrip/MatrixGram/actions/runs/43059181981) завершился успешно. Подписи скачанных пакетов и публичный адрес manifest проверены. Подробности и ограничения проверки на устройствах зафиксированы в [PROGRESS.md](../PROGRESS.md).

[0.5.3](https://github.com/VirusGrip/MatrixGram/releases/tag/v0.5.3) опубликована 12 ноября 2026 в 00:15 МСК после восстановления GitHub Actions. [Восстановительный выпуск](https://github.com/VirusGrip/MatrixGram/actions/runs/43099450306) и [полные проверки](https://github.com/VirusGrip/MatrixGram/actions/runs/43099449604) прошли. Подписи опубликованных Windows/APK, сертификат Android, содержимое source ZIP и HTTP 200 для публичного `latest.json` 0.5.3 проверены независимо. Реальная установка 0.5.2 → 0.5.3 на пользовательском устройстве пока не проверена.

Официальные источники: [Tauri updater](https://v2.tauri.app/plugin/updater/), [Android PackageManager](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()).
