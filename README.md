# MatrixGram

Клиент Matrix для Windows 10/11 x64 и Android. Tauri 2, React/TypeScript, Rust Matrix SDK, SQLite, Zustand. Сервер по умолчанию: **https://matrix.mad-frog.ru**.

**Это ранняя версия 0.1.0, а не завершённый продукт из исходного ТЗ.** Проверенные результаты и ограничения: [PROGRESS.md](PROGRESS.md).

В локальной поставке доступны [EXE Windows x64](releases/MatrixGram.exe), [установщик NSIS](releases/MatrixGram_0.1.0_x64-setup.exe) и [контрольные суммы](releases/SHA256SUMS.txt). В архиве исходников бинарные файлы не включены. Android APK пока отсутствует.

## Основные решения

- Все запросы Matrix выполняет Rust. Пароль нужен только для входа; токен не передаётся в WebView.
- E2EE исключено: `matrix-sdk` подключён с `default-features = false`. Нет восстановления ключей, верификации устройств и криптографического хранилища Matrix.
- Комнаты создаются без `m.room.encryption`. Существующие зашифрованные комнаты показываются как неподдерживаемые; отправка в них блокируется в Rust, независимо от интерфейса.
- Перед каждой отправкой клиент проверяет состояние шифрования на сервере. Неизвестное состояние и ошибки проверки блокируют отправку.
- Synapse, PostgreSQL, TURN и серверные службы не изменяются.
- На Windows сессия сохраняется с помощью Windows DPAPI. Android пока использует только сессию в памяти до реализации Android Keystore.

## Начало работы

Нужны Node.js 24, Rust 1.99.1 и Microsoft C++ Build Tools с Windows SDK. У пользователя приложения должен быть WebView2 Runtime. Подробнее: [сборка Windows](docs/BUILD_WINDOWS.md).

```powershell
npm ci
npm run tauri -- dev
```

В окне приложения введите существующий логин или полный Matrix ID и пароль. Вход SSO/OIDC и дополнительные этапы авторизации пока не поддерживаются; клиент сообщает об этом, не обходит их. Регистрации аккаунта нет.

`npm run dev` открывает только веб-оболочку без Rust. Вход в ней намеренно недоступен. Тестовые данные существуют только в `tests/`, в приложение они не входят.

## Проверки

```powershell
npm run build
npm test
npm exec -w @matrixgram/client -- playwright install chromium
npm run test:e2e
cargo test -p matrixgram-core --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
npm run check:policy
```

Интеграционные тесты Rust используют локальный HTTP-сервер wiremock. UI-тесты заменяют IPC тестовым адаптером. Эти проверки **не подтверждают** вход и обмен сообщениями на живом Synapse. Для этого нужен отдельный тестовый аккаунт и второй клиент; инструкция: [TESTING.md](docs/TESTING.md).

## Структура

```text
apps/client/src/           React, Zustand, проекция Matrix-событий, стили
apps/client/src-tauri/     Tauri IPC и задача синхронизации
crates/matrixgram-core/    Matrix SDK, политика E2EE, SQLite, DPAPI
assets/                   исходная иконка
docs/                     архитектура, сборка, проверка, ограничения
scripts/                  проверка сборочной политики
.github/workflows/        проверки и сборка артефактов
```

Документация: [архитектура](docs/ARCHITECTURE.md), [безопасность и E2EE](docs/SECURITY.md), [Android](docs/BUILD_ANDROID.md), [WebRTC и TURN](docs/CALLS.md), [карта ТЗ](docs/ROADMAP.md).

Лицензия проекта ещё не выбрана владельцем. Публикация на GitHub и выпуск подписанного релиза не выполнялись. Лицензии зависимостей сохраняют силу.
