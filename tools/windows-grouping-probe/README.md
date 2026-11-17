# Проверка группировки MatrixGram / WebView2

Изолированный тест на тех же Wry 0.57.1 / Tao 0.37.2, что в клиенте. Не обновление MatrixGram. Нативный запуск и свойства ID проверены автоматически; группировка диспетчера задач пока не проверена.

## Один тест на установленном MatrixGram

`MatrixGram - тест группировки.exe` запускает установленный `%LOCALAPPDATA%\MatrixGram\matrixgram.exe` с диагностическим флагом `--disable-features=msWindowsTaskManager` в окружении **только нового процесса**. Сам launcher сразу завершается. В диспетчере задач проверяется именно родительская группа **MatrixGram** и наличие всех его WebView2 внутри неё. Одним процессом они не становятся.

Сначала завершите MatrixGram через меню «Выход». Если клиент уже работает, launcher только покажет пояснение и ничего не запустит: single-instance передал бы управление старому окружению WebView2 без флага, и тест был бы недостоверным. Учётная запись, профиль, база данных и установленный exe используются обычные; дополнительных настроек в них launcher не пишет. Следующий обычный запуск ярлыком не получает флаг.

**Результат: вариант отклонён.** Пользователь подтвердил исчезновение отдельной строки «Диспетчер WebView2», но группа MatrixGram продолжила показывать около 40 МБ. Независимый замер дал 7 процессов, 164,61 МиБ всего и 37,48 МиБ основного процесса. Флаг не подтвердил требуемую агрегацию. В приложение и обновления он не перенесён. Следующий обычный запуск установленным ярлыком возвращает стандартное окружение.

Исходники launcher сохранены для воспроизведения в `MatrixGramGroupingLauncher.cs`; C# compiler входит в .NET Framework Windows. Сборка:

```powershell
./tools/windows-grouping-probe/build-launcher.ps1 -OutputDirectory <папка-диагностики>
```

## Package identity — подготовлено, требуется отдельное разрешение

Подготовлен следующий изолированный эксперимент: sparse MSIX с `runFullTrust` / `unvirtualizedResources`, отдельным диагностическим exe и встроенной идентичностью пакета. Реальный клиент, его аккаунты и база данных не используются. Native report проверяет `GetCurrentPackageFullName`, поэтому наличие identity не будет выводиться только из факта регистрации.

Попытка регистрации unsigned identity-only MSIX в текущем пользовательском контексте была отклонена Windows с **0x80073D2B**: unsigned пакет не может содержать исполняемые активации. Несмотря на отсутствие exe внутри MSIX, `Executable` в манифесте требует доверенной подписи. Повышение прав или изменение Developer Mode не выполнялись.

Создан семидневный тестовый сертификат `CN=MatrixGramGroupingProbe.Test` в **CurrentUser/My**, без экспорта private key. Им подписан пакет размером 3231 байт; CMS-подпись проверена без проверки доверия цепочки. Пользователь разрешил временный **CurrentUser/TrustedPeople** и регистрацию пакета. Этот вариант был выполнен, но Windows отклонила пакет с **0x80073CF0 / 0x800B0109**. Импорт автоматически откатился; отсутствие пакета и обоих TrustedPeople entries подтверждено.

Первоначально выбранная область CurrentUser оказалась недостаточной для службы MSIX. [Специализированная инструкция Microsoft](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing) требует **LocalMachine/TrustedPeople**. Такое доверие относится ко всем пользователям машины и требует администратора; согласие на CurrentUser его не покрывает.

Подготовлен, скомпилирован, но **не запущен** отдельный `MachineTrustLease.cs` с `requireAdministrator` manifest. Он допускает ровно public certificate с thumbprint `8F1198B5CF6E58233BD09628DFA8424AE72ED877`, отказывается перезаписывать существующее доверие, добавляет только LocalMachine/TrustedPeople и удаляет сертификат в `finally` после finish-file либо через 10 минут. Он не добавляет CA/TrustedRoot. Для запуска и этого изменения нужно отдельное разрешение и подтверждение UAC. Установка пользовательского пакета и запуск самого probe остаются без повышения прав, чтобы не исказить PID/grouping.

Пока machine helper не запускался; машинное доверие не менялось. Подтверждённого исправления группировки нет.

Подготовленная локальная папка: `D:\ДОМ\MatrixGram-Package-Identity-Test`. В ней — публичный `.cer`, подписанный `.msix`, отдельный exe/иконка, `test-package.json` с хешами, install/remove scripts. Private key в папку не входит. Скрипты проверяют identity, thumbprint и SHA256; установка не перезаписывает существующие trust/package. Очистка удаляет только зарегистрированный этим тестом пакет, его TrustedPeople certificate и личный signing key.

Сборка unsigned варианта (нужны полноценные SDK BuildTools MakeAppx/MT в PATH):

```powershell
./tools/windows-grouping-probe/build-sparse-package.ps1 -Binary <exe> -OutputDirectory <новая-папка>
```

Параметры `-Publisher` и `-IdentityName MadFrog.MatrixGram.GroupingProbe.Signed` позволяют собрать signed-кандидат перед подписанием SignTool сертификатом из CurrentUser/My. **Только после отдельного разрешения на LocalMachine** запускается machine trust helper через UAC, затем обычный `install-sparse-test.ps1 -BundleFolder <папка> -UseMachineTrust`. Для отката — `remove-sparse-test.ps1 -BundleFolder <папка>`; он удаляет пакет, посылает finish-file helper и проверяет удаление машинного сертификата, затем удаляет тестовый private key. Группировка signed-кандидата ещё не проверена.

Источники: [sparse package identity](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps), [unsigned MSIX restrictions](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package).

## Изолированные варианты

Закройте предыдущее тестовое окно перед следующим режимом. В диспетчере задач откройте «Процессы», включите сортировку **по памяти**. Найдите `MatrixGram-ID-test` и соответствующий WebView2.

1. `1 - обычный запуск.lnk` — без явного Windows ID.
2. `2 - ID процесса.lnk` — AppUserModelID задаётся до EventLoop/окна/WebView2.
3. `3 - ID процесса и окна.lnk` — дополнительно свойство AppUserModel.ID самого окна задаётся до создания WebView2.

17 ноября пользователь проверил первые три режима: WebView2 остался отдельной группой при сортировке по памяти. Эти изменения в клиент не перенесены.

Дополнительная пара тестов, с тем же новым exe `MatrixGram-Grouping-Diagnostic`:

4. `4 - проверка интеграции WebView2.lnk` — отключает `msWindowsTaskManager` только в окружении тестового процесса. Имя недокументированного feature обнаружено в установленном WebView2 157.0.4341.46; наличие строки не доказывает влияния флага. Проверка группировки вручную ещё требуется.
5. `5 - контроль без флага.lnk` — та же сборка без дополнительного флага. Сравнение проводится с №4 по очереди, не одновременно.

Это **только диагностика**, не настройка рабочего MatrixGram. [Microsoft предупреждает](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags), что browser flags могут измениться и не предназначены для production. Даже положительный A/B-результат не означает, что такой флаг можно объявить постоянным исправлением. Глобальные переменные окружения/реестр не изменяются; sandbox и изоляция процессов сохраняются.

Нужный результат: основной процесс и все его WebView2 находятся внутри **одной раскрываемой группы**, а ОЗУ суммируется. Изменение только названия/иконки не означает успех. Можно сообщить текстом, в каких режимах это получилось.

Тест показывает только локальный HTML. Нет подключения к Matrix, открытия аккаунтов, съёмки/мониторинга экрана, установки сертификатов, изменения настроек Windows или администратора. Профили и технические отчёты каждого запуска находятся отдельно в `%LOCALAPPDATA%\MatrixGramGroupingProbe\<режим>-<PID>`; после закрытия тестовых окон их можно удалить. Обычный MatrixGram можно оставить открытым.

## Воспроизведение

Подготовьте Rust/MSVC как для клиента. Из корня проекта:

```powershell
$env:CARGO_BUILD_JOBS='2'
cargo build --manifest-path tools/windows-grouping-probe/Cargo.toml --locked
cargo clippy --manifest-path tools/windows-grouping-probe/Cargo.toml --locked -- -D warnings
```

Утилита имеет собственный workspace/lockfile и не включает Matrix SDK или Tauri. Никакого изменения рабочего клиента пока нет. `--smoke` создаёт скрытое окно и ждёт IPC-сигнала от самого HTML-документа. Это предотвращает ложный успех при загрузке только пустого `about:blank`. Отчёт содержит `documentReady: true` и `taskManagerGroupingVerified: false`. Это не подтверждение исправления группировки.

После сборки нативные проверки можно воспроизвести:

```powershell
./tools/windows-grouping-probe/test.ps1 -Binary <путь-к-exe>
```

Сборку можно упаковать с двумя обязательными путями:

```powershell
./tools/windows-grouping-probe/package.ps1 -Binary <путь-к-exe> -OutputDirectory <новая-папка>
```

Документированные API: [SetCurrentProcessExplicitAppUserModelID](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-setcurrentprocessexplicitappusermodelid), [AppUserModel.ID](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-id), [SHGetPropertyStoreForWindow](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetpropertystoreforwindow). Свойство окна очищается перед уничтожением HWND. Эти API описывают идентификацию и панель задач; влияние на группировку Task Manager проверяется экспериментом.
