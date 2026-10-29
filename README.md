# MatrixGram 0.2.0

Клиент Matrix для Windows 10/11 x64 и Android: Tauri 2, React/TypeScript, Rust Matrix SDK, SQLite и Zustand. Сервер по умолчанию — **https://matrix.mad-frog.ru**.

Это ранняя версия. Полный статус и ограничения: [PROGRESS.md](PROGRESS.md).

## Сборки Windows

- [EXE 0.2.0](releases/MatrixGram-0.2.0-windows-x64.exe)
- [Установщик NSIS 0.2.0](releases/MatrixGram_0.2.0_x64-setup.exe)
- [SHA-256](releases/SHA256SUMS-0.2.0.txt)

Сборки без цифровой подписи. Установка/удаление через NSIS ещё не проверены. В архиве исходников бинарных файлов нет. Сборки 0.1.0 сохранены отдельно; APK пока отсутствует.

## Что добавлено

- Сбоку — **«Открыть зашифрованные комнаты»**. Вход не требует recovery key и не открывает мастер восстановления. Можно открыть доступные сообщения без старого ключа, подключить recovery key/пароль хранилища Matrix или импортировать зашифрованный экспорт ключей Element.
- Поиск людей по отображаемому имени/фамилии и Matrix ID: кнопка с людьми рядом с поиском чатов. Из результата можно открыть или создать личный чат.
- **ПАПКИ**: свои названия, выбор чатов, фильтр непрочитанных, редактирование, порядок и удаление. Папки сохраняются локально между запусками.

Новые комнаты и личные чаты по умолчанию остаются без E2EE. В существующие зашифрованные комнаты SDK отправляет шифротекст после включения доступа пользователем. Восстановление ключей не сбрасывает идентичность или настройки комнат; автоматическое создание backup и cross-signing отключено. Конфигурация Synapse, PostgreSQL и TURN не меняется.

Ключи SDK хранятся в SQLite с отдельным случайным паролем. Пароль хранилища и сессия защищены Windows DPAPI; токен не передаётся в WebView. Расшифрованная E2EE-история не записывается в открытый UI-кеш. Обычный кеш остаётся открытым и сохраняется после выхода.

## Разработка

Нужны Node.js 24, Rust 1.99.1 и Microsoft C++ Build Tools с Windows SDK. У пользователя приложения должен быть WebView2 Runtime.

```powershell
npm ci
npm run tauri -- dev
```

`npm run dev` запускает только веб-оболочку без Rust; вход в ней намеренно недоступен. Рабочее приложение использует настоящий Matrix SDK. Тестовые данные подключаются только в тестах.

```powershell
npm run build
npm test
npm exec -w @matrixgram/client -- playwright install chromium
npm run test:e2e
cargo test -p matrixgram-core --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
npm run check:policy
npm run tauri -- build --bundles nsis
```

## Документация

[Архитектура](docs/ARCHITECTURE.md), [безопасность и ключи](docs/SECURITY.md), [Windows](docs/BUILD_WINDOWS.md), [Android](docs/BUILD_ANDROID.md), [Matrix API](docs/MATRIX_API.md), [проверка на реальном сервере](docs/TESTING.md), [план](docs/ROADMAP.md), [звонки и TURN](docs/CALLS.md).

Лицензия проекта ещё не выбрана владельцем. Репозиторий локальный; публикация на GitHub и подпись релиза не выполнялись.
