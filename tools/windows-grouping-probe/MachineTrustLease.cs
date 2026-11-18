using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using System.Windows.Forms;

// Explicitly approved, temporary machine-level peer trust for ONE test cert.
// Never adds a root CA. The application/package itself runs without elevation.
internal static class MachineTrustLease
{
    private const string Thumbprint = "8F1198B5CF6E58233BD09628DFA8424AE72ED877";
    private const string Subject = "CN=MatrixGramGroupingProbe.Test";
    private static readonly string Folder = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string State = Path.Combine(Folder, "machine-trust-state.json");
    private static void Status(string state)
    {
        File.WriteAllText(State, "{\"status\":\"" + state + "\",\"thumbprint\":\"" + Thumbprint + "\",\"pid\":" + Process.GetCurrentProcess().Id + "}");
    }
    [STAThread]
    private static void Main()
    {
        bool added = false;
        bool removed = false;
        try
        {
            if (!File.Exists(Path.Combine(Folder, ".matrixgram-sparse-grouping-probe")))
                throw new InvalidOperationException("Diagnostic folder marker missing.");
            if (File.Exists(Path.Combine(Folder, "finish-machine-trust.request")))
                throw new InvalidOperationException("Test already completed. Refusing to renew trust.");
            using (X509Certificate2 cert = new X509Certificate2(File.ReadAllBytes(Path.Combine(Folder, "MatrixGramGroupingProbe.Test.cer"))))
            using (X509Store store = new X509Store(StoreName.TrustedPeople, StoreLocation.LocalMachine))
            {
                if (cert.Thumbprint != Thumbprint || cert.Subject != Subject || cert.HasPrivateKey || cert.NotAfter <= DateTime.Now)
                    throw new InvalidOperationException("Unexpected or expired test certificate.");
                foreach (X509Extension extension in cert.Extensions)
                {
                    X509BasicConstraintsExtension constraints = extension as X509BasicConstraintsExtension;
                    if (constraints != null && constraints.CertificateAuthority)
                        throw new InvalidOperationException("CA certificates are not allowed.");
                }
                store.Open(OpenFlags.ReadWrite | OpenFlags.OpenExistingOnly);
                if (store.Certificates.Find(X509FindType.FindByThumbprint, Thumbprint, false).Count != 0)
                    throw new InvalidOperationException("Certificate already exists. Refusing to modify existing trust.");
                try
                {
                    store.Add(cert);
                    added = true;
                    Status("ready");
                    DateTime deadline = DateTime.UtcNow.AddMinutes(10);
                    // Only our finish file is polled. No screen/application monitoring.
                    while (DateTime.UtcNow < deadline && !File.Exists(Path.Combine(Folder, "finish-machine-trust.request")))
                        Thread.Sleep(500);
                }
                finally
                {
                    if (added)
                    {
                        store.Remove(cert);
                        removed = store.Certificates.Find(X509FindType.FindByThumbprint, Thumbprint, false).Count == 0;
                        Status(removed ? "removed" : "cleanup-failed");
                    }
                }
            }
        }
        catch (Exception error)
        {
            if (!added) Status("failed-before-import");
            else if (!removed) Status("cleanup-failed");
            File.WriteAllText(Path.Combine(Folder, "machine-trust-error.txt"), error.Message);
            MessageBox.Show(error.Message, "MatrixGram — временный тестовый сертификат", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
