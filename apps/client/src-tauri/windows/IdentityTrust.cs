using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Threading;

[assembly: AssemblyTitle("MatrixGram — первоначальная настройка Windows")]
[assembly: AssemblyProduct("MatrixGram")]

// Elevated helper: only leases peer trust for the certificate embedded at build
// time. Never registers apps, launches commands, exports keys or adds root CAs.
internal static class IdentityTrust
{
    private static void WriteState(string folder, string status, bool preexisting)
    {
        string target = Path.Combine(folder,"state.json");
        string temporary = Path.Combine(folder,"state.tmp");
        File.WriteAllText(temporary, "{\"status\":\"" + status + "\",\"preexisting\":" + (preexisting ? "true" : "false") + ",\"pid\":" + Process.GetCurrentProcess().Id + "}");
        if (File.Exists(target)) File.Replace(temporary,target,null);
        else File.Move(temporary,target);
    }
    private static void ValidateFolder(string folder)
    {
        if (!Directory.Exists(folder) || File.ReadAllText(Path.Combine(folder,"owner.txt")) != "MatrixGramIdentitySetup/v1")
            throw new InvalidOperationException("Invalid setup handshake folder.");
        for (DirectoryInfo current = new DirectoryInfo(folder); current != null; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Reparse points are not allowed in the handshake path.");
    }
    private static int Main(string[] args)
    {
        string folder = null;
        try
        {
            int parentPid;
            if (args.Length != 2 || !Int32.TryParse(args[1], out parentPid) || parentPid <= 0) return 2;
            folder = Path.GetFullPath(args[0]);
            ValidateFolder(folder);
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("MatrixGram.Publisher"))
            using (MemoryStream bytes = new MemoryStream())
            {
                if (resource == null) throw new InvalidOperationException("Embedded certificate missing.");
                resource.CopyTo(bytes);
                using (X509Certificate2 cert = new X509Certificate2(bytes.ToArray()))
                using (Process parent = Process.GetProcessById(parentPid))
                {
                    if (cert.Subject != "CN=MatrixGram" || cert.HasPrivateKey || cert.NotAfter <= DateTime.Now)
                        throw new InvalidOperationException("Invalid publisher certificate.");
                    foreach (X509Extension extension in cert.Extensions)
                    {
                        X509BasicConstraintsExtension constraints = extension as X509BasicConstraintsExtension;
                        if (constraints != null && constraints.CertificateAuthority)
                            throw new InvalidOperationException("CA certificates are not allowed.");
                    }
                    MutexSecurity security = new MutexSecurity();
                    security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null),MutexRights.FullControl,AccessControlType.Allow));
                    security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),MutexRights.FullControl,AccessControlType.Allow));
                    bool created;
                    using (Mutex mutex = new Mutex(false,"Global\\MatrixGramIdentity_" + cert.Thumbprint,out created,security))
                    {
                        bool locked = false;
                        try
                        {
                            try { locked = mutex.WaitOne(TimeSpan.FromSeconds(60)); }
                            catch (AbandonedMutexException) { locked = true; }
                            if (!locked || parent.HasExited) throw new InvalidOperationException("Setup lease timed out.");
                            using (X509Store store = new X509Store(StoreName.TrustedPeople,StoreLocation.LocalMachine))
                            {
                                store.Open(OpenFlags.ReadWrite | OpenFlags.OpenExistingOnly);
                                bool preexisting = store.Certificates.Find(X509FindType.FindByThumbprint,cert.Thumbprint,false).Count != 0;
                                bool added = false;
                                try
                                {
                                    if (!preexisting) { store.Add(cert); added = true; }
                                    WriteState(folder,"ready",preexisting);
                                    DateTime deadline = DateTime.UtcNow.AddSeconds(180);
                                    while (DateTime.UtcNow < deadline && !parent.HasExited && !File.Exists(Path.Combine(folder,"finish.request")))
                                        Thread.Sleep(200);
                                }
                                finally
                                {
                                    if (added) store.Remove(cert);
                                    bool removed = preexisting || store.Certificates.Find(X509FindType.FindByThumbprint,cert.Thumbprint,false).Count == 0;
                                    WriteState(folder,removed ? "finished" : "cleanup-failed",preexisting);
                                }
                            }
                        }
                        finally { if (locked) mutex.ReleaseMutex(); }
                    }
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (folder != null) { try { File.WriteAllText(Path.Combine(folder,"error.txt"),error.Message); } catch { } }
            return 1;
        }
    }
}
