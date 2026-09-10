using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("KPLAYER")]
[assembly: AssemblyDescription("Private media player and web-to-TV companion")]
[assembly: AssemblyCompany("KPLAYER contributors")]
[assembly: AssemblyProduct("KPLAYER")]
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool offline = Path.GetFileNameWithoutExtension(Application.ExecutablePath).EndsWith("-Offline", StringComparison.OrdinalIgnoreCase);
        bool smoke = Array.IndexOf(args, "--smoke-test") >= 0;
        var server = new PlayerServer(offline, smoke);
        try
        {
            server.ValidatePackage();
            if (Array.IndexOf(args, "--check-package") >= 0) return 0;
            if (smoke)
            {
                try
                {
                    if (server.IsReady()) return 3; // Never disturb an existing session during a build check.
                    server.StartAsync().GetAwaiter().GetResult();
                    if (!server.IsReady()) return 4;
                    server.StopAsync().GetAwaiter().GetResult();
                    if (server.IsReady()) return 5;
                    return 0;
                }
                finally { server.CleanDiagnosticDirectory(); }
            }
            bool first;
            using (var mutex = new Mutex(true, "Local\\KPLAYER.Launcher." + server.Mode, out first))
            {
                if (!first) { Open(server.EntryUrl); return 0; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new PlayerTray(server));
                mutex.ReleaseMutex();
            }
            return 0;
        }
        catch (Exception error)
        {
            if (!smoke) MessageBox.Show(error.Message, "KPLAYER", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    internal static void Open(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}

internal sealed class PlayerServer
{
    internal readonly string Mode;
    internal readonly string Url;
    internal readonly string EntryUrl;
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly bool diagnostic;
    private readonly int port;
    private readonly string storage;
    private Process child;

    internal PlayerServer(bool offline, bool smoke)
    {
        Mode = offline ? "offline" : "internet";
        diagnostic = smoke;
        port = smoke ? (offline ? 3228 : 3227) : (offline ? 3213 : 3210);
        Url = "http://localhost:" + port;
        EntryUrl = offline ? Url : "https://ssallem.github.io/Kplayer/";
        storage = smoke ? Path.Combine(Path.GetTempPath(), "KPLAYER-launcher-check-" + Guid.NewGuid().ToString("N"))
            : Path.Combine(root, offline ? "data\\offline" : "data");
    }
    internal void ValidatePackage()
    {
        foreach (string file in new[] { "runtime\\node.exe", "server\\index.js", "dist\\index.html", "node_modules\\express\\package.json" })
            if (!File.Exists(Path.Combine(root, file)))
                throw new Exception("실행에 필요한 파일이 없습니다. ZIP을 모두 압축 해제한 폴더에서 실행해 주세요.\n\nEXE만 다른 폴더로 옮기지 말고 바로가기를 사용하세요.");
    }
    private string Request(string path, bool post)
    {
        // Bind to IPv4 explicitly: the media server listens on IPv4, while
        // older .NET localhost resolution can wait on IPv6 until timeout.
        var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
        request.Proxy = null;
        request.Timeout = post ? 15000 : 900;
        request.ReadWriteTimeout = request.Timeout;
        request.Method = post ? "POST" : "GET";
        if (post) request.ContentLength = 0;
        using (var response = request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
    }
    internal bool IsReady()
    {
        try
        {
            var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Request("/api/state", false));
            return state.ContainsKey("cast") && state.ContainsKey("mode") && (string)state["mode"] == Mode;
        }
        catch { return false; }
    }
    internal async Task StartAsync()
    {
        ValidatePackage();
        if (await Task.Run(() => IsReady())) return;
        Directory.CreateDirectory(storage);
        var info = new ProcessStartInfo(Path.Combine(root, "runtime\\node.exe"), "\"" + Path.Combine(root, "server\\index.js") + "\" --production")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        info.EnvironmentVariables["KPLAYER_MODE"] = Mode;
        info.EnvironmentVariables["PORT"] = port.ToString();
        info.EnvironmentVariables["KPLAYER_DATA"] = storage;
        child = new Process { StartInfo = info };
        child.OutputDataReceived += delegate { };
        child.ErrorDataReceived += delegate { };
        child.Start();
        child.BeginOutputReadLine(); child.BeginErrorReadLine();
        File.WriteAllText(Path.Combine(storage, "server.pid"), child.Id.ToString());
        for (int attempt = 0; attempt < 60; attempt++)
        {
            if (await Task.Run(() => IsReady())) return;
            if (child.HasExited) throw new Exception("플레이어를 시작하지 못했습니다. 다른 KPLAYER를 종료한 뒤 다시 실행해 주세요.");
            await Task.Delay(300);
        }
        throw new Exception("플레이어 시작 시간이 초과됐습니다. 보안 프로그램의 차단 여부와 폴더 쓰기 권한을 확인해 주세요.");
    }
    internal async Task StopAsync()
    {
        if (await Task.Run(() => IsReady())) await Task.Run(() => Request("/api/shutdown", true));
        if (child != null) await Task.Run(() => child.WaitForExit(5000));
    }
    internal void CleanDiagnosticDirectory()
    {
        if (!diagnostic || !Directory.Exists(storage)) return;
        // Only our fresh diagnostic directory; no recursive deletion or media import.
        string temporary = Path.Combine(storage, "private-session");
        if (Directory.Exists(temporary)) Directory.Delete(temporary, false);
        string pid = Path.Combine(storage, "server.pid");
        if (File.Exists(pid)) File.Delete(pid);
        Directory.Delete(storage, false);
    }
}

internal sealed class PlayerTray : ApplicationContext
{
    private readonly PlayerServer server;
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem open, web, exit;
    private readonly Form splash;
    private readonly Label status;
    private bool stopping;

    internal PlayerTray(PlayerServer player)
    {
        server = player;
        var menu = new ContextMenuStrip();
        open = new ToolStripMenuItem(server.Mode == "internet" ? "웹 플레이어 열기" : "플레이어 열기", null, delegate { Program.Open(server.EntryUrl); }) { Enabled = false };
        web = new ToolStripMenuItem("PC 플레이어 열기", null, delegate { Program.Open(server.Url); }) { Enabled = false };
        exit = new ToolStripMenuItem("재생 종료 · KPLAYER 끝내기", null, async delegate { await Stop(); }) { Enabled = false };
        menu.Items.Add(open);
        if (server.Mode == "internet") menu.Items.Add(web);
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add(exit);
        tray = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), Text = server.Mode == "offline" ? "KPLAYER · 비인터넷" : "KPLAYER · 인터넷", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { if (open.Enabled) Program.Open(server.EntryUrl); };
        splash = new Form { Text = "KPLAYER", ClientSize = new Size(390, 180), StartPosition = FormStartPosition.CenterScreen,
            BackColor = Color.FromArgb(246, 247, 242), FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
            ControlBox = false, Icon = tray.Icon, Font = new Font("맑은 고딕", 10) };
        splash.Controls.Add(new Label { Text = "KPLAYER.", ForeColor = Color.FromArgb(41, 52, 37), Font = new Font("Segoe UI", 23, FontStyle.Bold), Location = new Point(26, 22), AutoSize = true });
        status = new Label { Text = "플레이어를 준비하고 있습니다…", Location = new Point(29, 92), Size = new Size(340, 58), ForeColor = Color.FromArgb(85, 105, 68) };
        splash.Controls.Add(status);
        splash.Shown += async delegate
        {
            try
            {
                await server.StartAsync();
                open.Enabled = web.Enabled = exit.Enabled = true;
                Program.Open(server.EntryUrl);
                splash.Hide();
                tray.ShowBalloonTip(3500, "KPLAYER 실행 중", "이 아이콘을 더블클릭하면 플레이어가 열립니다. 종료는 오른쪽 클릭 메뉴를 사용하세요.", ToolTipIcon.Info);
            }
            catch (Exception error)
            {
                MessageBox.Show(splash, error.Message, "KPLAYER", MessageBoxButtons.OK, MessageBoxIcon.Error);
                DisposeTray(); ExitThread();
            }
        };
        splash.Show();
    }
    private async Task Stop()
    {
        if (stopping) return;
        stopping = true; open.Enabled = web.Enabled = exit.Enabled = false;
        try { await server.StopAsync(); }
        catch (Exception)
        {
            if (server.IsReady())
            {
                MessageBox.Show("진행 중인 작업이 끝난 뒤 다시 종료해 주세요.", "KPLAYER", MessageBoxButtons.OK, MessageBoxIcon.Information);
                stopping = false; open.Enabled = web.Enabled = exit.Enabled = true; return;
            }
        }
        DisposeTray(); ExitThread();
    }
    private void DisposeTray() { tray.Visible = false; tray.Dispose(); splash.Dispose(); }
}
