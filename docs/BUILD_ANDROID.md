# Android 0.5.2

Клиент использует общий Rust SDK и React UI. В исходниках есть JNI bridge для Android Keystore, TLS verifier, разрешений, системного сохранения, Back и ACTION_SEND/ACTION_SEND_MULTIPLE. Браузерный viewport не подтверждает работу APK на телефоне. Статус APK указан в PROGRESS.md.

## Воспроизводимая подготовка

Использовались JDK 21, Android SDK Platform/Build Tools 36, NDK 29.0.14206865 и Rust target aarch64-linux-android. minSdk 26 (Android 8), target/compileSdk 36. На Windows размещайте **реальные** каталоги проекта, Rust toolchain и SDK по коротким ASCII-путям. Junction не меняет канонический путь rustc: NDK cmd-wrapper может испортить кириллицу при линковке.

Настройте JAVA_HOME, ANDROID_HOME, NDK_HOME, PATH согласно [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#android).

```powershell
rustup target add aarch64-linux-android
npm ci
npm run tauri -- android init --ci
node scripts/prepare-android.mjs
npm run tauri -- android build --debug --apk --target aarch64 --ci
```

После повторного `android init` снова выполните prepare-android. Генерируемый `src-tauri/gen/android` исключён из Git. Шаблон bridge хранится в `apps/client/android/MainActivity.kt`.

Tauri CLI на Windows создаёт символьную ссылку на собранную `.so`. Если система запрещает ссылки, после успешной компиляции можно скопировать `target/aarch64-linux-android/debug/libmatrixgram_app.so` в `gen/android/app/src/main/jniLibs/arm64-v8a/` и из `gen/android` выполнить `gradlew.bat :app:assembleArm64Debug -x :app:rustBuildArm64Debug`. При CARGO_TARGET_DIR берите библиотеку из этого каталога. Эта команда упаковывает уже собранную библиотеку; после изменения Rust её нужно пересобрать и снова скопировать. Настройки безопасности Windows автоматически не меняются.

prepare-android добавляет permissions, share intent filters, min/target SDK, allowBackup=false и keep rules. JVM-компонент `org.rustls:rustls-platform-verifier` выбирается из версии rustls-platform-verifier-android в Cargo.lock. JNI init получает applicationContext до сетевой работы; проверка сертификатов не отключается. [Официальный компонент](https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/org/rustls/rustls-platform-verifier/0.2.0/rustls-platform-verifier-0.2.0.pom).

Сессия/пароль store/закрытые черновики шифруются AES-256-GCM, ключ не экспортируется из Android Keystore. Передача файлов использует системный document picker без доступа ко всему хранилищу. Микрофон/камера запрашиваются при записи/звонке, уведомления — явной кнопкой в настройках. Share показывает выбор получателя до отправки. Back сначала закрывает диалог, затем возвращает к чатам.

До релиза обязательны: запуск на arm64-устройстве, HTTPS login/sync/send, restart/session restore/Keystore, поворот/клавиатура/safe areas, Back/share/save, разрешения с отказом, WebRTC/audio/video и уход в фон. FCM/UnifiedPush и call foreground service не реализованы: в закрытом/усыплённом приложении доставка уведомлений/звонков не гарантируется.

Debug APK использует тестовую подпись и предназначен для проверки. Signing keystore хранится вне Git. В release CI 0.5.2 сохранён сертификат прежних тестовых установок; переход на production-подпись требует отдельного плана миграции. Не заменяйте существующую подпись автоматически.

Для preview доступен ручной workflow `.github/workflows/android.yml` на Ubuntu 24.04, JDK 21 и закреплённом NDK; отдельно он пока не запускался. Подписанные пакеты выпускает `.github/workflows/release.yml`, который устанавливает закреплённые Android command-line tools, SDK и NDK. Фактический результат первого выпуска указан в [PROGRESS.md](../PROGRESS.md). Windows workflow запускает тесты всего workspace.


Обновления APK реализованы через собственный JNI bridge и системный установщик: `REQUEST_INSTALL_PACKAGES`, ограниченный FileProvider private cache, проверка подписи, package ID и versionCode. Updater Tauri предназначен для desktop, поэтому его установка на Android не вызывается. [Канал обновлений](UPDATES.md).

Release CI задаёт MATRIXGRAM_ANDROID_KEYSTORE_PATH, MATRIXGRAM_ANDROID_STORE_PASSWORD, MATRIXGRAM_ANDROID_KEY_ALIAS и MATRIXGRAM_ANDROID_KEY_PASSWORD. prepare-android добавляет постоянную signingConfig для release. Старые тестовые установки требуют исходного debug keystore; переход на случайную подпись runner не допускается. Локальная debug-сборка и сборка release в GitHub — разные артефакты, их статус указан в PROGRESS.
