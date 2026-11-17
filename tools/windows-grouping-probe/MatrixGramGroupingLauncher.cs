using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

// A one-launch diagnostic for the actual installed MatrixGram. This launcher
// exits after spawning the client; no monitoring or persistent setting exists.
internal static class MatrixGramGroupingLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MatrixGram");
            string client = Path.Combine(directory, "matrixgram.exe");
            if (!File.Exists(client))
                throw new InvalidOperationException("Установленный MatrixGram не найден: " + client);
            using (Process current = Process.GetCurrentProcess())
            {
                foreach (Process process in Process.GetProcessesByName("matrixgram"))
                {
                    using (process)
                    {
                        if (process.Id == current.Id) continue;
                        // Avoid touching a running client or silently handing off
                        // to the old WebView2 environment through single-instance.
                        throw new InvalidOperationException("Сначала завершите MatrixGram через меню «Выход», затем запустите этот тест ещё раз. Принудительно закрывать приложение тест не будет.");
                    }
                }
            }
            const string key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
            if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                throw new InvalidOperationException("Уже задан WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS. Дополнительные настройки могут исказить результат теста.");
            ProcessStartInfo start = new ProcessStartInfo(client);
            start.UseShellExecute = false;
            start.WorkingDirectory = directory;
            start.EnvironmentVariables[key] = "--disable-features=msWindowsTaskManager";
            using (Process child = Process.Start(start))
            {
                if (child == null) throw new InvalidOperationException("Не удалось запустить MatrixGram.");
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "MatrixGram — тест группировки", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
