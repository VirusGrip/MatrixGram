# Проверки 0.5.0

Фактические числа и артефакты зафиксированы в PROGRESS.md. Тесты ниже запускаются локально; они не входят в production приложение.

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
4. Отправить/получить image/video/audio/file и голосовое. Переключить чат при отправке, отменить/повторить; проверить сохранение и файл >25 МБ.
5. До включения E2EE нет истории/отправки в закрытую комнату. Проверить неправильный/правильный recovery key, импорт/экспорт, restart и реальный обмен зашифрованными текстом/файлом с Element. После unlock проверить текст превью и фото собеседника в нескольких DM без их открытия; ключ последнего события может отсутствовать даже после recovery. Отдельно проверить redaction уже расшифрованного события после пропуска sync и последующей загрузки истории. Не сбрасывать существующие backup/cross-signing.
6. Создать обычную группу и канал, пригласить второго тестового участника, проверить права/запрет отправки, роль/ban/leave. Проверить rooms directory и matrix.to link.
7. Добавить второй аккаунт, переключить несколько раз, перезапустить, выйти только из выбранного профиля. Отозвать отдельное тестовое устройство с UIA-паролем.
8. Два клиента: audio/video/permissions/mute/hangup; затем relay-only TURN, NAT и потеря сети. Проверить поддержку именно room VoIP v1 у второго клиента.
9. Android arm64: startup/TLS/login, restore через Keystore, Back/keyboard/rotation/share/save, permission denial, background limitations. Debug APK не считается проверенным телефоном.

Учётные данные пользователя, действующий TURN и реальные переписки в автоматических проверках не использовались. Нет подтверждения чистой установки, физического Android, реального E2EE recovery пользователя, real TURN/Element или системных уведомлений. Не подменять эти пункты результатом mock-тестов.
