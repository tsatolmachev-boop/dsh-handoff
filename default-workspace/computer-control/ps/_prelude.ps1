# Общая часть скриптов управления компьютером: разбор payload, запись результата,
# Win32-обёртка (мышь, клавиатура, окна, DPI).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$script:Payload = $null
if ($env:DSH_CC_PAYLOAD) {
    try {
        $rawPayload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:DSH_CC_PAYLOAD))
        $script:Payload = $rawPayload | ConvertFrom-Json
    } catch {
        throw "invalid payload: $($_.Exception.Message)"
    }
}
$script:DshResultPath = $env:DSH_CC_RESULT
$script:DshScreenshotDir = $env:DSH_CC_SHOTS

function Write-DshResult {
    param([Parameter(Mandatory = $true)][AllowNull()]$Value)
    if (-not $script:DshResultPath) { throw 'DSH_CC_RESULT is not set' }
    $json = ConvertTo-Json -InputObject $Value -Compress -Depth 10
    [System.IO.File]::WriteAllText($script:DshResultPath, $json, [System.Text.UTF8Encoding]::new($false))
}

$dshWinSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DshWin
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }

    public class WindowInfo
    {
        public long hwnd;
        public string title;
        public string className;
        public int pid;
        public string processName;
        public int x;
        public int y;
        public int width;
        public int height;
        public bool minimized;
        public bool foreground;
    }

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);

    public static void MakeDpiAware()
    {
        try { SetProcessDPIAware(); } catch { }
    }

    public static bool IsForeground(long hwnd)
    {
        return GetForegroundWindow().ToInt64() == hwnd;
    }

    public static int MouseX()
    {
        POINT point;
        GetCursorPos(out point);
        return point.X;
    }

    public static int MouseY()
    {
        POINT point;
        GetCursorPos(out point);
        return point.Y;
    }

    public static bool MoveTo(int x, int y)
    {
        return SetCursorPos(x, y);
    }

    public static void Click(string button, int count)
    {
        uint down;
        uint up;
        switch (button)
        {
            case "right": down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; break;
            case "middle": down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; break;
            default: down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; break;
        }
        for (int index = 0; index < count; index++)
        {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(15);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            if (index + 1 < count) Thread.Sleep(70);
        }
    }

    public static void Wheel(string direction, int clicks)
    {
        int delta = (direction == "down" ? -1 : 1) * 120 * clicks;
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
    }

    private static bool IsExtendedKey(int virtualKey)
    {
        switch (virtualKey)
        {
            case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27: case 0x28:
            case 0x2D: case 0x2E: case 0xA3: case 0xA5: case 0x6F: case 0x5B: case 0x5C:
                return true;
            default:
                return false;
        }
    }

    public static void PressKeys(int[] virtualKeys)
    {
        foreach (int virtualKey in virtualKeys) SendKey((ushort)virtualKey, false);
        for (int index = virtualKeys.Length - 1; index >= 0; index--) SendKey((ushort)virtualKeys[index], true);
    }

    private static void SendKey(ushort virtualKey, bool up)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = virtualKey;
        input.u.ki.wScan = 0;
        input.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (IsExtendedKey(virtualKey) ? KEYEVENTF_EXTENDEDKEY : 0);
        input.u.ki.time = 0;
        input.u.ki.dwExtraInfo = IntPtr.Zero;
        SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
        Thread.Sleep(8);
    }

    private static void FlushInputs(List<INPUT> buffer)
    {
        if (buffer.Count == 0) return;
        SendInput((uint)buffer.Count, buffer.ToArray(), Marshal.SizeOf(typeof(INPUT)));
        buffer.Clear();
    }

    private static void PressVirtualKey(ushort virtualKey)
    {
        SendKey(virtualKey, false);
        SendKey(virtualKey, true);
    }

    public static void TypeUnicode(string text, int delayMs)
    {
        List<INPUT> buffer = new List<INPUT>();
        foreach (char character in text)
        {
            if (character == '\r') continue;
            if (character == '\n')
            {
                FlushInputs(buffer);
                PressVirtualKey(0x0D);
                Thread.Sleep(Math.Max(delayMs, 8));
                continue;
            }
            if (character == '\t')
            {
                FlushInputs(buffer);
                PressVirtualKey(0x09);
                Thread.Sleep(Math.Max(delayMs, 8));
                continue;
            }
            INPUT down = new INPUT();
            down.type = INPUT_KEYBOARD;
            down.u.ki.wVk = 0;
            down.u.ki.wScan = (ushort)character;
            down.u.ki.dwFlags = KEYEVENTF_UNICODE;
            down.u.ki.time = 0;
            down.u.ki.dwExtraInfo = IntPtr.Zero;
            buffer.Add(down);
            INPUT up = new INPUT();
            up.type = INPUT_KEYBOARD;
            up.u.ki.wVk = 0;
            up.u.ki.wScan = (ushort)character;
            up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            up.u.ki.time = 0;
            up.u.ki.dwExtraInfo = IntPtr.Zero;
            buffer.Add(up);
            if (buffer.Count >= 64)
            {
                FlushInputs(buffer);
                if (delayMs > 0) Thread.Sleep(delayMs);
            }
        }
        FlushInputs(buffer);
    }

    private static string ReadTitle(IntPtr hWnd)
    {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return string.Empty;
        StringBuilder text = new StringBuilder(length + 2);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    private static WindowInfo Describe(IntPtr hWnd, string title)
    {
        RECT rect;
        GetWindowRect(hWnd, out rect);
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        WindowInfo info = new WindowInfo();
        info.hwnd = hWnd.ToInt64();
        info.title = title;
        StringBuilder className = new StringBuilder(256);
        GetClassName(hWnd, className, className.Capacity);
        info.className = className.ToString();
        info.pid = (int)processId;
        info.processName = string.Empty;
        try { info.processName = Process.GetProcessById((int)processId).ProcessName; } catch { info.processName = string.Empty; }
        info.x = rect.Left;
        info.y = rect.Top;
        info.width = rect.Right - rect.Left;
        info.height = rect.Bottom - rect.Top;
        info.minimized = IsIconic(hWnd);
        info.foreground = hWnd == GetForegroundWindow();
        return info;
    }

    public static WindowInfo[] ListWindows(bool includeUntitled)
    {
        List<WindowInfo> windows = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            string title = ReadTitle(hWnd);
            if (!includeUntitled && title.Length == 0) return true;
            windows.Add(Describe(hWnd, title));
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static WindowInfo FindWindow(string titlePart)
    {
        string needle = (titlePart == null ? string.Empty : titlePart).ToLowerInvariant();
        WindowInfo found = null;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            string title = ReadTitle(hWnd);
            if (title.Length == 0) return true;
            if (title.ToLowerInvariant().IndexOf(needle, StringComparison.Ordinal) < 0) return true;
            ShowWindow(hWnd, 9);
            try { SetForegroundWindow(hWnd); } catch { }
            try { BringWindowToTop(hWnd); } catch { }
            try { SwitchToThisWindow(hWnd, true); } catch { }
            found = Describe(hWnd, title);
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'DshWin').Type) {
    Add-Type -TypeDefinition $dshWinSource -Language CSharp -ErrorAction Stop
}
try { [DshWin]::MakeDpiAware() | Out-Null } catch { }
