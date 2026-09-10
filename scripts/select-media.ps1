param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PrivateMediaPicker {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class OpenFileName {
        public int lStructSize = Marshal.SizeOf(typeof(OpenFileName));
        public IntPtr hwndOwner, hInstance;
        public string lpstrFilter = "Media files\0*.mp4;*.m4v;*.mkv;*.avi;*.mov;*.webm;*.mp3;*.m4a;*.ogg;*.wav\0\0";
        public IntPtr lpstrCustomFilter;
        public int nMaxCustFilter, nFilterIndex = 1;
        public IntPtr lpstrFile;
        public int nMaxFile = 32768;
        public IntPtr lpstrFileTitle;
        public int nMaxFileTitle;
        public string lpstrInitialDir;
        public string lpstrTitle = "KPLAYER - Open media (matching subtitles load automatically)";
        // DONTADDTORECENT | EXPLORER | FILEMUSTEXIST | PATHMUSTEXIST | NOCHANGEDIR
        public int Flags = 0x02081808;
        public short nFileOffset, nFileExtension;
        public string lpstrDefExt;
        public IntPtr lCustData, lpfnHook, lpTemplateName, pvReserved;
        public int dwReserved, FlagsEx;
    }
    [DllImport("comdlg32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool GetOpenFileName([In,Out] OpenFileName ofn);
    public static string Select() {
        var dialog = new OpenFileName();
        dialog.lpstrFile = Marshal.AllocHGlobal(dialog.nMaxFile * 2);
        Marshal.WriteInt16(dialog.lpstrFile, 0);
        try { return GetOpenFileName(dialog) ? Marshal.PtrToStringUni(dialog.lpstrFile) : null; }
        finally { Marshal.FreeHGlobal(dialog.lpstrFile); }
    }
}
'@
if (-not $ValidateOnly) { [PrivateMediaPicker]::Select() | ConvertTo-Json -Compress }
