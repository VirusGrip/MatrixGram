# Проверки 0.5.7

## Передача файлов 0.5.7

Автоматические native тесты: границы 0/500 МиБ/+1 байт; зашифрованная подготовка и очистка; потоковый plain/E2EE roundtrip; неверный hash и отмена без подмены существующего файла; заголовок и неизвестный Content-Length; свежий серверный предел и запрет закрытой комнаты до отправки; контракт SDK event и токен только в Rust. Native IPC reader проверяет порядок/подтверждение блоков и отмену без следующего сообщения.

Browser IPC fixture проверяет 500 последовательных блоков по 1 МиБ без base64, ранний отказ, повтор после ошибки, системное сохранение, прогресс при переходе в другой чат, отмену, Android share handles и запрет установки обновления при передаче. Это не native WebView или телефон.

```powershell
cargo test -p matrixgram-core --locked large_file_maximum_streaming_load -- --ignored --nocapture
```

Нагрузочный тест реально передаёт и скачивает 500 МиБ через локальный HTTP, использует SDK attachment cipher и сравнивает итоговые байты. Нужно около 1,5 ГиБ свободного места. Включён в Windows CI. [Локальный результат](file-transfer-0.5.7-local.json) относится только к тестовому процессу. Реальная отправка в Matrix и Android SAF/Share требуют отдельной проверки; автоматические тесты не пишут в переписки пользователя.

Фактические числа и артефакты зафиксированы в PROGRESS.md. Тесты ниже запускаются локально; они не входят в production приложение.

Итог 0.5.5: [полный CI](https://github.com/VirusGrip/MatrixGram/actions/runs/44099898571) — 52 Rust-, 43 frontend-, 53 браузерных теста, 2 browser load, SQLite load, fmt/Clippy/policy. [Release CI](https://github.com/VirusGrip/MatrixGram/actions/runs/44099905589) — Windows и Android собраны и подписаны, 2 Node release-tool теста прошли. Опубликованные пакеты проверены независимо по updater-подписям, сертификату APK, SHA-256 и Git-дереву source ZIP. Ручной UI установленной 0.5.5 не проверен.

В 0.5.5: нативное дерево исключает другие приложения и потомков повторно использованного PID; неизвестный ancestor помечает неполный результат, циклы завершаются. Повторяющиеся имена PDH сохраняют отдельные instance indices, включая недоступные позиции. Системный тест получает реальную память собственного процесса; повторные замеры не накапливают native handles. Browser проверяет сумму WebView2+клиент, таблицу, refresh/close, hidden/visible, неполные значения и очистку устаревшей цифры при ошибке. Ручной ignored-тест live client запускается отдельно с MATRIXGRAM_MEMORY_PID; production IPC не принимает PID другого приложения. [Результат сверки](memory-0.5.5-live.json).

Итог 0.5.4: [CI](https://github.com/VirusGrip/MatrixGram/actions/runs/43846426836) успешно выполнил 47 Rust-, 43 frontend-, 48 браузерных тестов, 2 браузерных нагрузочных сценария, SQLite-нагрузку, fmt/Clippy/policy. [Release CI](https://github.com/VirusGrip/MatrixGram/actions/runs/43846440038) собрал и подписал Windows и Android, выполнил также 2 Node release-tool теста. Независимо проверены скачанные опубликованные пакеты и точное соответствие source ZIP Git-дереву тега. Установка и клики ОС остаются отдельной ручной проверкой.

В 0.5.4 добавлены: восстановление последних 50 E2EE-сообщений/имён/курсора через DPAPI при пустом состоянии нового SDK клиента; сохранение последнего списка комнат до первого sync; восстановление медиа в новом клиенте с единственным HTTP download и проверкой отсутствия открытых байтов в SDK store; несовпадающий E2EE descriptor не использует старый кеш. Frontend покрывает offline cache/reconnect, race между кешем и live profile/redaction, повреждённый кеш, автоматическое объявление версии/интервал и защиту скачанного пакета. Browser IPC покрывает cold/warm activation, ожидание login, чужой аккаунт, banner обновления и touch-меню без постоянной 👍. URI/Windows toast XML проверяются Rust-тестами. Это не OS integration test центра уведомлений.

В 0.5.3 добавлены нативные сценарии профиля отправителя в локальной странице без HTTP, смены имени/прав через state-only sync и stripped invitation без timeline. Пагинация проверяет имя отсутствующего локально отправителя из membership state ответа `/messages`. Frontend проверяет атомарное появление имён с сообщениями, свежесть истории/повтор после ошибки и недостающих ключей, изоляцию сессий и поздних результатов после recovery. Браузерный тест удерживает history до явного разрешения, проверяет первое имя и шесть повторных открытий с одним запросом; приглашения проверяются после sync и при входе, вне выбранного фильтра, с принятием/отклонением и одним вызовом native notification. Это не проверка системного toast или приглашений на реальном Synapse пользователя.

- Rust: настоящий Matrix SDK обращается к wiremock. Проверяются login/sync/history/txn/auth, E2EE/Megolm, encrypted export/import с неверным паролем, защищённый store/DPAPI, папки/DM/directory, выбор аватара по m.direct и сохранение фото группы с двумя участниками, plaintext и encrypted attachment upload, авторизованный media download/decryption и отказ при повреждении, channel power levels, call whitelist, UIA удаления устройства, mentions/forward и разбор room links.
- Frontend unit: проекция/группировка, авторство правок, дубликаты/redaction/реакции, обработка неизвестных полей, превью E2EE после unlock, правки/redaction и недоступный последний ключ, личные названия DM.
- Playwright: отдельный IPC fixture; login/send/retry/drafts/keys/folders, desktop/mobile/resize/virtualization, фото upload/preview/save, участники/профиль/pin/forward, безопасный HTML, MediaRecorder с настоящими аудиобайтами, audio playback/seek/save, смена аккаунта, background upload/cancel, server search, read-only channel, share/Back и масштаб; фоновое превью E2EE без plaintext в LocalStorage, повторные переключения с room info без дублей/выхода grid, фото DM/group, подпись без setProfile и изоляция аккаунтов, контекстное закрепление, выбор нескольких сообщений и хронологическая пересылка, partial retry без дубля доставленного события.
- WebRTC: два настоящих browser peer, RTP packetsReceived > 0, mute и stopped tracks после hangup. Matrix transport при этом тестовый. Это не проверка вашего TURN или Element.
- cargo fmt, Clippy --workspace --all-targets -D warnings, frontend production build, check:policy.

## Проверка на реальном сервере

Используйте отдельный тестовый аккаунт; пароль/recovery key вводятся в приложении.

1. Обновить предыдущую версию, проверить прежнюю сессию/комнаты/черновики. На чистых Windows 10/11 проверить installer/uninstall, WebView2, tray/autostart и системный toast с текстом/без текста.
2. Найти пользователя по фамилии, сверить Matrix ID, дважды открыть DM без дубля; сменить имя/фото и проверить с Element.
3. Подписать контакт, перезапустить, проверить изоляцию второго аккаунта и неизменность имени у собеседника. Закрепить чат ПКМ и проверить фильтр. Выделить несколько сообщений, переслать, прервать сеть после части отправок и повторить без дублей. Переключать диалоги с открытой информацией о комнате и при разных ширинах окна. Обменяться текстом/ответом/правкой/реакцией/forward/pin, загрузить старую историю и найти серверный результат. Проверить typing/read receipt.
4. Отправить/получить image/video/audio/file и голосовое. Переключить чат при отправке, отменить/повторить; проверить сохранение, файлы 26/100/500 МиБ и отказ при 500 МиБ + 1 байт.
5. До включения E2EE нет истории/отправки в закрытую комнату. Проверить неправильный/правильный recovery key, импорт/экспорт, restart и реальный обмен зашифрованными текстом/файлом с Element. После unlock проверить текст превью и фото собеседника в нескольких DM без их открытия; ключ последнего события может отсутствовать даже после recovery. Отдельно проверить redaction уже расшифрованного события после пропуска sync и последующей загрузки истории. Не сбрасывать существующие backup/cross-signing.
6. Создать обычную группу и канал, пригласить второго тестового участника, проверить права/запрет отправки, роль/ban/leave. Проверить rooms directory и matrix.to link.
7. Добавить второй аккаунт, переключить несколько раз, перезапустить, выйти только из выбранного профиля. Отозвать отдельное тестовое устройство с UIA-паролем.
8. Два клиента: audio/video/permissions/mute/hangup; затем relay-only TURN, NAT и потеря сети. Проверить поддержку именно room VoIP v1 у второго клиента.
9. Android arm64: startup/TLS/login, restore через Keystore, Back/keyboard/rotation/share/save, permission denial, background limitations. Собранный APK не считается проверенным телефоном.

Учётные данные пользователя, действующий TURN и реальные переписки в автоматических проверках не использовались. Нет подтверждения чистой установки, физического Android, реального E2EE recovery пользователя, real TURN/Element или системных уведомлений. Не подменять эти пункты результатом mock-тестов.

## Нагрузка

```powershell
npm run test:load
cargo test --workspace --locked cache_load_100000_events -- --ignored --nocapture
```

Нагрузочные тесты отделены от обычного Playwright-набора. Используется локальный IPC, не Synapse. JSON отчёт браузера: `apps/client/performance-results/browser-current.json`; native метрики печатаются как `LOAD_CACHE_JSON`. Профиль, пороги, параметры длительного прогона и пределы интерпретации — [PERFORMANCE.md](PERFORMANCE.md). В 0.5.3 Windows workflow успешно выполнил 42 Rust-, 37 frontend-, 43 браузерных теста, отдельную нагрузку и Clippy: [GitHub Actions](https://github.com/VirusGrip/MatrixGram/actions/runs/43099449604). [Облачный отчёт 0.5.3](performance-0.5.3-ci.json) относится к browser IPC; это не замер физического Android или native WebView2.


## Updater

Rust: настоящая подпись отдельным test key, tamper, подмена версии, запрет downgrade/prerelease и чужих URL. Frontend unit: ожидание сохранения черновиков и ошибки callback. Playwright: цепочка check/download/install, plain-text notes, подпись/ошибка, Android permission/retry без повторного download, актуальная версия, отказ при несохранённом черновике. Node: manifest обеих платформ и согласованность bump версий.

```powershell
node --test scripts/release-manifest.test.mjs scripts/release-version.test.mjs
node scripts/check-workflows.mjs
node scripts/check-release-version.mjs
```

Реально проверить: установить 0.5.2, опубликовать следующую тестовую версию, обновить через Settings с сохранением сессии/E2EE/подписей/папок на Windows 10/11 и Android arm64. Проверить сеть/отказ разрешения/отмену установщика/нехватку места/неправильный сертификат APK. Не считать mock UI или подпись файла проверкой успешной установки.

## 0.5.6: Windows identity

`./scripts/test-windows-integration.ps1` проверяет публичную подпись/хеши MSIX, embedded publisher помощника и настоящий NSIS hook code на изолированной файловой fixture. Проверяется сохранение native directory File ID на `/UPDATE`, удаление собственных marker/каталога на uninstall и отсутствие добавленного доверия. OS-регистрация и UAC намеренно не выполняются в этом тесте.

`windows-integration.spec.ts` проверяет opt-in, необходимость перезапуска вместо ложного активного статуса, отказ, ошибку и неподдерживаемую платформу. `notification-test.spec.ts` проверяет permission и локальную цель уведомления без сообщений людям. Это IPC fixture, не доказательство реальной OS-доставки.

Решение package identity вручную подтверждено пользователем на копии MatrixGram 0.5.4 после удаления доверия и замены внешнего exe. 18 ноября обычная установка локального кандидата 0.5.6, группа, профиль и тестовый toast/клик подтверждены пользователем. Для перезагрузки Windows и Windows 10 требуется [ручной сценарий](WINDOWS_PROCESS_GROUPING.md#проверка-финального-установщика).
