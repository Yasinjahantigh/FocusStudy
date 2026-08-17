// FocusStudy native-messaging host shim.
//
// Chrome/Edge launch THIS executable for native messaging (stdio protocol).
// The Electron GUI binary cannot be used as the host directly: during its
// GUI boot the Chromium runtime emits a stray "\r\n" to stdout and the app
// bundle logs its Win32 FFI init — bytes that land on the pipe before the
// relay process takes over. Native messaging parses stdout as 4-byte
// little-endian length frames, so any stray byte desyncs the stream and the
// browser drops the host silently ("installed but nothing happens").
//
// This shim is a tiny console app that writes NOTHING. It launches the
// bridge script (resources\bridge-entry.js) under ELECTRON_RUN_AS_NODE via
// CreateProcessW, handing the browser's stdio handles to the child, so every
// byte on stdout comes exclusively from the relay. The relay's watchdog
// exits when this launcher PID disappears (Chrome kills us on disconnect),
// leaving no orphan processes behind.
//
// Compiled at package time from build/native-host-shim.cs (see
// build/afterPack.js). Targets .NET Framework 4.x (present on every modern
// Windows). Keep C# 5 compatible.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class NativeHostShim
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFOW
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    private const int STARTF_USESTDHANDLES = 0x00000101;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr hSourceProcessHandle,
        IntPtr hSourceHandle,
        IntPtr hTargetProcessHandle,
        out IntPtr lpTargetHandle,
        uint dwDesiredAccess,
        bool bInheritHandle,
        uint dwOptions);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFOW lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    // The browser hands us pipe handles that may not be marked inheritable;
    // duplicate them into inheritable copies before passing them on.
    private static bool DuplicateInheritable(IntPtr src, out IntPtr dup)
    {
        return DuplicateHandle(
            GetCurrentProcess(), src, GetCurrentProcess(), out dup,
            0, true, DUPLICATE_SAME_ACCESS);
    }

    // Win32 env block: null-terminated "NAME=VALUE" strings, double-null end.
    private static IntPtr BuildEnvironmentBlock(string launcherPid)
    {
        string[] keys = {
            "APPDATA", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE",
            "HOMEPATH", "PATH", "SYSTEMROOT", "COMSPEC", "PATHEXT", "ProgramFiles",
            "ProgramFiles(x86)", "ProgramData", "COMMONPROGRAMFILES", "OS",
            "PROCESSOR_ARCHITECTURE", "USERNAME", "USERDOMAIN",
        };
        string block = "";
        foreach (string key in keys)
        {
            string value = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrEmpty(value))
            {
                block += key + "=" + value + "\0";
            }
        }
        block += "ELECTRON_RUN_AS_NODE=1\0";
        block += "FOCUSSTUDY_LAUNCHER_PID=" + launcherPid + "\0";
        string userData = UserDataDir();
        if (userData.Length > 0)
        {
            block += "FOCUSSTUDY_USERDATA_DIR=" + userData + "\0";
        }
        block += "\0";
        char[] chars = block.ToCharArray();
        IntPtr ptr = Marshal.AllocHGlobal((chars.Length + 1) * 2);
        Marshal.Copy(chars, 0, ptr, chars.Length);
        Marshal.WriteInt16(ptr, chars.Length * 2, 0);
        return ptr;
    }

    private static string UserDataDir()
    {
        try
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (!string.IsNullOrEmpty(appData))
            {
                return appData + "\\focus-study";
            }
        }
        catch
        {
            // fall through
        }
        return "";
    }

    private static int Main()
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string electronExe = Path.Combine(baseDir, "FocusStudyBrowserBridge.exe");
            string relayScript = Path.Combine(baseDir, "resources", "bridge-entry.js");

            if (!File.Exists(electronExe) || !File.Exists(relayScript))
            {
                return 2;
            }

            IntPtr stdinDup = IntPtr.Zero, stdoutDup = IntPtr.Zero, stderrDup = IntPtr.Zero;
            bool ok =
                DuplicateInheritable(GetStdHandle(STD_INPUT_HANDLE), out stdinDup) &&
                DuplicateInheritable(GetStdHandle(STD_OUTPUT_HANDLE), out stdoutDup) &&
                DuplicateInheritable(GetStdHandle(STD_ERROR_HANDLE), out stderrDup);
            if (!ok)
            {
                return 4;
            }

            STARTUPINFOW si = new STARTUPINFOW();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFOW));
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = stdinDup;
            si.hStdOutput = stdoutDup;
            si.hStdError = stderrDup;

            string commandLine = "\"" + electronExe + "\" \"" + relayScript + "\"";
            IntPtr envBlock = BuildEnvironmentBlock(
                Process.GetCurrentProcess().Id.ToString());
            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
            try
            {
                bool started = CreateProcessW(
                    null,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                    envBlock,
                    baseDir,
                    ref si,
                    out pi);
                if (!started)
                {
                    return 3;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(envBlock);
                CloseHandle(stdinDup);
                CloseHandle(stdoutDup);
                CloseHandle(stderrDup);
            }

            CloseHandle(pi.hThread);
            WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
            uint exitCode;
            GetExitCodeProcess(pi.hProcess, out exitCode);
            CloseHandle(pi.hProcess);
            return (int)exitCode;
        }
        catch
        {
            return 1;
        }
    }
}
