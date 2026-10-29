# Android

Android использует те же React-экраны и `matrixgram-core` через Tauri 2. UI адаптируется к узкому экрану и показывает список чатов/переписку по отдельности. Проверка мобильного viewport в браузере не является проверкой Android.

## Подготовка

Установите Android Studio, JDK 17+, Android SDK Platform, Build Tools, Command-line Tools, Platform Tools и совместимый NDK. Задайте `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` согласно [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/#android).

```powershell
rustup target add aarch64-linux-android
npm ci
npm run tauri -- android init
npm run tauri -- android dev
npm run tauri -- android build --apk --target aarch64
```

Tauri генерирует `apps/client/src-tauri/gen/android`. Папка исключена из Git: она воспроизводится командой `android init`. Исходный Rust crate имеет mobile entrypoint, `staticlib/cdylib/rlib`, общий identifier и адаптивный интерфейс. Иконки Android находятся в `src-tauri/icons/android`.

## Что требуется до выпуска

- Реализовать и проверить сохранение/восстановление токена через Android Keystore. Сейчас вход живёт только до завершения процесса.
- Проверить инициализацию TLS verifier Matrix SDK/Reqwest в Android runtime, при необходимости подключить Java/JNI bridge.
- Проверить системную кнопку/жест «Назад», клавиатуру, safe area, поворот, уход в фон и повторное открытие.
- Добавить Android native Back bridge, чтобы системный back сначала возвращал к списку чатов.
- Проверить настоящий login/sync/send на отдельном аккаунте.
- Проверить ограничения фоновых процессов; push пока нет.
- Создать собственный release keystore, хранить его вне Git и настроить подпись.

Камера, микрофон и уведомления пока не запрашиваются: соответствующие функции не реализованы. APK нельзя считать готовым только по наличию команды сборки. Фактический статус сборки указан в PROGRESS.md.
