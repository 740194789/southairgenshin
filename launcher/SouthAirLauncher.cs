using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace SouthAirLauncher
{
    internal static class Program
    {
        private const string WindowTitle = "南空提瓦特小助手";

        [STAThread]
        private static void Main()
        {
            bool created;
            Mutex mutex = new Mutex(true, "NankongTeyvatLauncherSingleInstance", out created);
            if (!created)
            {
                IntPtr handle = FindWindow(null, WindowTitle);
                if (handle != IntPtr.Zero)
                {
                    ShowWindow(handle, 9);
                    SetForegroundWindow(handle);
                }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
            GC.KeepAlive(mutex);
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr handle);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr handle, int command);
    }

    /// <summary>侧边栏按钮：自绘圆角，支持选中 / 悬停 / 高亮三种状态。</summary>
    internal class SideButton : Control
    {
        public bool Active;
        public bool Accent;
        public string Glyph = "";
        public int GlyphWidth = 26;

        private bool hover;

        public SideButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            Font = new Font("Microsoft YaHei UI", 9.5f);
            Height = 42;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float scale = g.DpiX / 96f;
            Rectangle rect = new Rectangle(1, 1, Width - 3, Height - 3);

            Color back = Color.Transparent;
            Color fore = Color.FromArgb(200, 204, 219);
            Color glyphColor = UiColors.Gold;

            if (Active)
            {
                back = UiColors.Gold;
                fore = Color.FromArgb(24, 22, 16);
                glyphColor = Color.FromArgb(96, 76, 34);
            }
            else if (Accent)
            {
                back = hover ? UiColors.Hover : UiColors.Card;
                fore = UiColors.Text;
            }
            else if (hover)
            {
                back = UiColors.Hover;
                fore = UiColors.Text;
            }

            if (back != Color.Transparent)
            {
                using (GraphicsPath path = RoundedRect(rect, (int)Math.Round(12 * scale)))
                {
                    if (Active)
                    {
                        using (LinearGradientBrush brush = new LinearGradientBrush(
                            rect, UiColors.GoldLight, UiColors.Gold, 90f))
                        {
                            g.FillPath(brush, path);
                        }
                    }
                    else
                    {
                        using (SolidBrush brush = new SolidBrush(back))
                        {
                            g.FillPath(brush, path);
                        }
                    }
                }
            }

            if (Active)
            {
                using (Pen pen = new Pen(Color.FromArgb(80, 255, 255, 255)))
                using (GraphicsPath path = RoundedRect(rect, (int)Math.Round(12 * scale)))
                {
                    g.DrawPath(pen, path);
                }
            }
            else if (hover)
            {
                using (Pen pen = new Pen(Color.FromArgb(46, 211, 188, 142)))
                using (GraphicsPath path = RoundedRect(rect, (int)Math.Round(12 * scale)))
                {
                    g.DrawPath(pen, path);
                }
            }

            if (!string.IsNullOrEmpty(Glyph))
            {
                using (Font glyphFont = new Font("Segoe UI Symbol", 12f, FontStyle.Regular))
                using (SolidBrush glyphBrush = new SolidBrush(glyphColor))
                {
                    g.DrawString(Glyph, glyphFont, glyphBrush,
                        15 * scale, (Height - 20 * scale) / 2f);
                }
            }

            Rectangle textRect = new Rectangle(
                (int)Math.Round((15 + GlyphWidth) * scale), 0,
                Width - (int)Math.Round((GlyphWidth + 26) * scale), Height);
            using (StringFormat format = new StringFormat())
            {
                format.LineAlignment = StringAlignment.Center;
                format.Alignment = StringAlignment.Near;
                format.Trimming = StringTrimming.EllipsisCharacter;
                using (SolidBrush brush = new SolidBrush(fore))
                {
                    g.DrawString(Text, Font, brush, textRect, format);
                }
            }
        }

        internal static GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    /// <summary>侧边栏主操作卡：渐变底 + 金色描边，突出「启动原神」这个第一动作。</summary>
    internal class LaunchCard : Control
    {
        private bool hover;

        public LaunchCard()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            float scale = g.DpiX / 96f;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);

            using (GraphicsPath path = SideButton.RoundedRect(rect, (int)Math.Round(14 * scale)))
            {
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    rect,
                    hover ? Color.FromArgb(42, 51, 76) : Color.FromArgb(32, 39, 59),
                    hover ? Color.FromArgb(22, 27, 43) : Color.FromArgb(16, 20, 33),
                    105f))
                {
                    g.FillPath(brush, path);
                }
                using (Pen pen = new Pen(hover
                    ? Color.FromArgb(205, 211, 188, 142)
                    : Color.FromArgb(105, 211, 188, 142),
                    Math.Max(1f, (float)Math.Round(scale))))
                {
                    g.DrawPath(pen, path);
                }
            }

            int circle = (int)Math.Round(42 * scale);
            Rectangle badge = new Rectangle((int)Math.Round(14 * scale),
                (Height - circle) / 2, circle, circle);
            using (LinearGradientBrush brush = new LinearGradientBrush(
                badge, UiColors.GoldLight, UiColors.GoldDeep, 60f))
            {
                g.FillEllipse(brush, badge);
            }
            using (Font glyphFont = new Font("Segoe UI Symbol", 10f, FontStyle.Bold))
            using (SolidBrush brush = new SolidBrush(Color.FromArgb(30, 26, 17)))
            using (StringFormat format = new StringFormat())
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                g.DrawString("▶", glyphFont, brush, badge, format);
            }

            int textLeft = (int)Math.Round(68 * scale);
            using (Font titleFont = new Font("Microsoft YaHei UI", 11f, FontStyle.Bold))
            using (SolidBrush brush = new SolidBrush(hover ? Color.White : UiColors.GoldLight))
            {
                g.DrawString("启动原神", titleFont, brush,
                    textLeft, (int)Math.Round(19 * scale));
            }
            using (Font subFont = new Font("Microsoft YaHei UI", 7.5f))
            using (SolidBrush brush = new SolidBrush(UiColors.TextDim))
            {
                g.DrawString("自动搜索 · 一键启动", subFont, brush,
                    textLeft, (int)Math.Round(46 * scale));
            }
            using (Font arrowFont = new Font("Segoe UI Symbol", 13f))
            using (SolidBrush brush = new SolidBrush(UiColors.Gold))
            using (StringFormat format = new StringFormat())
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                g.DrawString("›", arrowFont, brush,
                    new RectangleF(Width - (int)Math.Round(36 * scale), 0,
                        (int)Math.Round(26 * scale), Height), format);
            }
        }
    }

    /// <summary>轻量金色进度条，替代系统 ProgressBar 的灰色跑马灯。</summary>
    internal class IndeterminateBar : Control
    {
        private readonly System.Windows.Forms.Timer timer;
        private float phase;

        public IndeterminateBar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            timer = new System.Windows.Forms.Timer();
            timer.Interval = 16;
            timer.Tick += delegate
            {
                phase += 0.012f;
                if (phase > 1f)
                {
                    phase -= 1f;
                }
                Invalidate();
            };
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible)
            {
                timer.Start();
            }
            else
            {
                timer.Stop();
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Dispose();
            }
            base.Dispose(disposing);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float scale = g.DpiX / 96f;
            int radius = Math.Max(1, Height / 2);
            Rectangle track = new Rectangle(0, 0, Width, Height);
            GraphicsPath shape = SideButton.RoundedRect(track, radius);
            try
            {
                using (SolidBrush brush = new SolidBrush(Color.FromArgb(32, 39, 58)))
                {
                    g.FillPath(brush, shape);
                }

                int barWidth = Math.Max((int)Math.Round(90 * scale), Width / 3);
                int left = (int)Math.Round(phase * (Width + barWidth)) - barWidth;
                Rectangle piece = new Rectangle(left, 0, barWidth, Height);
                Region previous = g.Clip;
                g.SetClip(shape);
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    piece, Color.FromArgb(0, 211, 188, 142), Color.FromArgb(0, 211, 188, 142), 0f))
                {
                    ColorBlend blend = new ColorBlend(3);
                    blend.Colors = new[]
                    {
                        Color.FromArgb(0, 211, 188, 142),
                        Color.FromArgb(235, 242, 226, 189),
                        Color.FromArgb(0, 211, 188, 142)
                    };
                    blend.Positions = new[] { 0f, 0.5f, 1f };
                    brush.InterpolationColors = blend;
                    g.FillRectangle(brush, piece);
                }
                g.Clip = previous;
            }
            finally
            {
                shape.Dispose();
            }
        }
    }

    internal static class UiColors
    {
        public static readonly Color Bg = Color.FromArgb(14, 17, 29);
        public static readonly Color SideBg = Color.FromArgb(9, 11, 19);
        public static readonly Color SideSoft = Color.FromArgb(15, 18, 30);
        public static readonly Color Card = Color.FromArgb(20, 24, 39);
        public static readonly Color Hover = Color.FromArgb(27, 33, 50);
        public static readonly Color Line = Color.FromArgb(40, 46, 68);
        public static readonly Color Gold = Color.FromArgb(211, 188, 142);
        public static readonly Color GoldLight = Color.FromArgb(242, 226, 189);
        public static readonly Color GoldDeep = Color.FromArgb(166, 132, 78);
        public static readonly Color Text = Color.FromArgb(230, 232, 240);
        public static readonly Color TextDim = Color.FromArgb(139, 147, 167);
        public static readonly Color TextFaint = Color.FromArgb(96, 103, 124);
        public static readonly Color Green = Color.FromArgb(112, 214, 144);
        public static readonly Color Red = Color.FromArgb(255, 138, 138);
    }

    internal class LauncherForm : Form
    {
        private const int Port = 8080;
        private const string ServiceUrl = "http://127.0.0.1:8080/";
        private const int MaxTicks = 240; // 400ms * 240 ≈ 96 秒
        private const string RepoLatestRelease =
            "https://api.github.com/repos/740194789/southairgenshin/releases/latest";
        private const string JarFileName = "南空提瓦特小助手.jar";
        private const string UpdateUserAgent = "NankongTeyvat-Launcher";

        private readonly string baseDir;
        private readonly string dataDir;
        private readonly string logPath;
        private readonly object logLock = new object();

        private Panel titleBar;
        private Panel sidebar;
        private Panel contentHost;
        private Panel loadingPanel;
        private Panel loadingCard;
        private WebView2 webView;
        private CoreWebView2Environment coreEnvironment;
        private LaunchCard launchCard;
        private float uiScale = 1f;

        private Panel statusPill;
        private Label statusDot;
        private Label statusText;
        private Label loadingTitle;
        private Label loadingHint;
        private Label errorLabel;
        private Label versionLabel;
        private IndeterminateBar progressBar;
        private Panel errorActions;

        private System.Windows.Forms.Timer pollTimer;
        private Process javaProcess;
        private int ticks;
        private bool serviceReady;
        private bool webInitialized;
        private bool closing;
        private bool updateBusy;

        private readonly Dictionary<string, SideButton> navButtons = new Dictionary<string, SideButton>();

        public LauncherForm()
        {
            baseDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
            dataDir = Path.Combine(baseDir, "data");
            logPath = Path.Combine(baseDir, "launcher.log");

            Text = "南空提瓦特小助手";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            BackColor = UiColors.Bg;
            DoubleBuffered = true;
            // 清单已声明 DPI 感知，这里按系统 DPI 手动缩放布局，避免整窗被系统位图拉伸导致发虚
            AutoScaleMode = AutoScaleMode.None;
            Font = new Font("Microsoft YaHei UI", 9f);
            KeyPreview = true;
            uiScale = DpiScale();
            float scale = uiScale;
            MinimumSize = new Size((int)Math.Round(1000 * scale), (int)Math.Round(900 * scale));
            Size = new Size((int)Math.Round(1180 * scale), (int)Math.Round(900 * scale));

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                // 没有图标时使用默认窗口图标
            }

            BuildUi();
            ScaleControlTree(this, scale);
            FitToWorkingArea();
            AppendLog("界面缩放 " + (int)Math.Round(scale * 100) + "%，窗口 "
                + Width + "x" + Height);
            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 400;
            pollTimer.Tick += PollTimer_Tick;

            Shown += delegate
            {
                FitToWorkingArea();
                PrepareWebView();
                StartService(false);
            };
            FormClosing += LauncherForm_FormClosing;
        }

        /** 系统 DPI 缩放比（150% = 1.5）；旧系统取不到时退回 Graphics.DpiX */
        internal static float DpiScale()
        {
            try
            {
                uint dpi = GetDpiForSystem();
                if (dpi >= 96)
                {
                    return Math.Min(3f, dpi / 96f);
                }
            }
            catch
            {
                // Windows 10 1607 以下没有 GetDpiForSystem
            }
            using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero))
            {
                return Math.Min(3f, graphics.DpiX / 96f);
            }
        }

        internal static void ScaleControlTree(Control parent, float scale)
        {
            if (Math.Abs(scale - 1f) < 0.01f)
            {
                return;
            }
            foreach (Control child in parent.Controls)
            {
                child.SetBounds(
                    (int)Math.Round(child.Left * scale),
                    (int)Math.Round(child.Top * scale),
                    (int)Math.Round(child.Width * scale),
                    (int)Math.Round(child.Height * scale));
                ScaleControlTree(child, scale);
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                // Win11：窗口圆角（DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2）
                int preference = 2;
                DwmSetWindowAttribute(Handle, 33, ref preference, 4);
            }
            catch
            {
                // Windows 10 没有该属性，保持直角即可
            }
        }

        private void FitToWorkingArea()
        {
            Rectangle area = Screen.FromControl(this).WorkingArea;
            if (Width > area.Width)
            {
                Width = area.Width;
            }
            if (Height > area.Height)
            {
                Height = area.Height;
            }
            Left = area.X + Math.Max(0, (area.Width - Width) / 2);
            Top = area.Y + Math.Max(0, (area.Height - Height) / 2);
        }

        /* ------------------------------ 界面 ------------------------------ */

        private void BuildUi()
        {
            Panel border = new Panel();
            border.Dock = DockStyle.Fill;
            border.BackColor = UiColors.Line;
            border.Padding = new Padding(1);
            Controls.Add(border);

            Panel root = new Panel();
            root.Dock = DockStyle.Fill;
            root.BackColor = UiColors.Bg;
            border.Controls.Add(root);

            contentHost = new Panel();
            contentHost.Dock = DockStyle.Fill;
            contentHost.BackColor = UiColors.Bg;
            contentHost.Resize += delegate { CenterLoadingCard(); };
            root.Controls.Add(contentHost);

            BuildSidebar();
            root.Controls.Add(sidebar);

            BuildTitleBar();
            root.Controls.Add(titleBar);

            BuildWebView();
            BuildLoadingPanel();
        }

        private void BuildTitleBar()
        {
            titleBar = new Panel();
            titleBar.Dock = DockStyle.Top;
            titleBar.Height = 52;
            titleBar.BackColor = UiColors.SideBg;
            titleBar.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(1, titleBar.Width), titleBar.Height),
                    Color.FromArgb(11, 14, 24), UiColors.Bg, 0f))
                {
                    g.FillRectangle(brush, 0, 0, titleBar.Width, titleBar.Height);
                }
                using (Pen pen = new Pen(Color.FromArgb(40, 46, 68)))
                {
                    g.DrawLine(pen, 0, titleBar.Height - 1, titleBar.Width, titleBar.Height - 1);
                }
                using (Pen pen = new Pen(Color.FromArgb(80, 211, 188, 142)))
                {
                    g.DrawLine(pen, 0, titleBar.Height - 1,
                        (int)Math.Round(62 * uiScale), titleBar.Height - 1);
                }
            };
            titleBar.MouseDown += DragArea_MouseDown;
            titleBar.DoubleClick += delegate { ToggleMaximize(); };

            Panel logo = new Panel();
            logo.SetBounds(20, 13, 28, 28);
            logo.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                if (Icon != null)
                {
                    g.DrawIcon(Icon, new Rectangle(0, 0, 28, 28));
                }
            };
            logo.MouseDown += DragArea_MouseDown;
            logo.DoubleClick += delegate { ToggleMaximize(); };
            titleBar.Controls.Add(logo);

            statusPill = new Panel();
            statusPill.Size = new Size(196, 30);
            statusPill.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            statusPill.BackColor = Color.Transparent;
            statusPill.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                Rectangle box = new Rectangle(0, 0, statusPill.Width - 1, statusPill.Height - 1);
                using (GraphicsPath path = SideButton.RoundedRect(box,
                    (int)Math.Round(15 * uiScale)))
                using (SolidBrush brush = new SolidBrush(Color.FromArgb(18, 22, 36)))
                {
                    g.FillPath(brush, path);
                }
                using (Pen pen = new Pen(Color.FromArgb(44, 50, 72)))
                using (GraphicsPath path = SideButton.RoundedRect(box,
                    (int)Math.Round(15 * uiScale)))
                {
                    g.DrawPath(pen, path);
                }
            };
            statusPill.MouseDown += DragArea_MouseDown;
            titleBar.Controls.Add(statusPill);

            statusDot = new Label();
            statusDot.AutoSize = true;
            statusDot.Text = "●";
            statusDot.ForeColor = UiColors.Gold;
            statusDot.Font = new Font("Segoe UI Symbol", 9f);
            statusDot.Location = new Point(12, 6);
            statusDot.BackColor = Color.Transparent;
            statusPill.Controls.Add(statusDot);

            statusText = new Label();
            statusText.AutoSize = false;
            statusText.Text = "准备启动";
            statusText.ForeColor = UiColors.TextDim;
            statusText.Font = new Font("Microsoft YaHei UI", 8.5f);
            statusText.BackColor = Color.Transparent;
            statusText.SetBounds(28, 5, 158, 20);
            statusPill.Controls.Add(statusText);

            Button close = MakeWindowButton("✕", Color.FromArgb(255, 138, 138));
            close.Click += delegate { Close(); };
            close.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            close.Location = new Point(titleBar.Width - (int)Math.Round(54 * uiScale),
                (int)Math.Round(10 * uiScale));
            titleBar.Controls.Add(close);

            Button maximize = MakeWindowButton("□", UiColors.TextDim);
            maximize.Click += delegate { ToggleMaximize(); };
            maximize.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            maximize.Location = new Point(titleBar.Width - (int)Math.Round(100 * uiScale),
                (int)Math.Round(10 * uiScale));
            titleBar.Controls.Add(maximize);

            Button minimize = MakeWindowButton("—", UiColors.TextDim);
            minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
            minimize.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            minimize.Location = new Point(titleBar.Width - (int)Math.Round(146 * uiScale),
                (int)Math.Round(10 * uiScale));
            titleBar.Controls.Add(minimize);

            titleBar.Resize += delegate
            {
                statusPill.Location = new Point(
                    titleBar.Width - statusPill.Width - (int)Math.Round(156 * uiScale),
                    (int)Math.Round(11 * uiScale));
                close.Location = new Point(titleBar.Width - (int)Math.Round(54 * uiScale),
                    (int)Math.Round(10 * uiScale));
                maximize.Location = new Point(titleBar.Width - (int)Math.Round(100 * uiScale),
                    (int)Math.Round(10 * uiScale));
                minimize.Location = new Point(titleBar.Width - (int)Math.Round(146 * uiScale),
                    (int)Math.Round(10 * uiScale));
            };
        }

        private Button MakeWindowButton(string text, Color hoverColor)
        {
            Button button = new Button();
            button.Text = text;
            button.Size = new Size(42, 32);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 0;
            button.BackColor = Color.Transparent;
            button.ForeColor = UiColors.TextDim;
            button.Font = new Font("Segoe UI", 10f);
            button.Cursor = Cursors.Hand;
            button.TabStop = false;
            button.MouseEnter += delegate
            {
                button.BackColor = UiColors.Hover;
                button.ForeColor = hoverColor;
            };
            button.MouseLeave += delegate
            {
                button.BackColor = Color.Transparent;
                button.ForeColor = UiColors.TextDim;
            };
            return button;
        }

        private void BuildSidebar()
        {
            sidebar = new Panel();
            sidebar.Dock = DockStyle.Left;
            sidebar.Width = 260;
            sidebar.BackColor = UiColors.SideBg;
            sidebar.Paint += delegate(object sender, PaintEventArgs e)
            {
                using (Pen pen = new Pen(Color.FromArgb(34, 40, 60)))
                {
                    e.Graphics.DrawLine(pen, sidebar.Width - 1, 0,
                        sidebar.Width - 1, sidebar.Height);
                }
            };

            Panel brand = new Panel();
            brand.Dock = DockStyle.Top;
            brand.Height = 96;
            brand.BackColor = UiColors.SideBg;
            brand.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    new Rectangle(16, 34, 3, 34), UiColors.GoldLight, UiColors.GoldDeep, 90f))
                using (GraphicsPath path = SideButton.RoundedRect(
                    new Rectangle(16, 34, 3, 34), (int)Math.Round(2 * uiScale)))
                {
                    g.FillPath(brush, path);
                }
                using (Pen pen = new Pen(Color.FromArgb(30, 36, 54)))
                {
                    g.DrawLine(pen, 16, brand.Height - 1, brand.Width - 16, brand.Height - 1);
                }
            };

            Label brandTitle = new Label();
            brandTitle.AutoSize = true;
            brandTitle.Text = "南空提瓦特小助手";
            brandTitle.ForeColor = UiColors.GoldLight;
            brandTitle.Font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold);
            brandTitle.Location = new Point(30, 24);
            brand.Controls.Add(brandTitle);

            Label brandSub = new Label();
            brandSub.AutoSize = true;
            brandSub.Text = "提瓦特数据 · 本地工作台";
            brandSub.ForeColor = UiColors.TextDim;
            brandSub.Font = new Font("Microsoft YaHei UI", 8.5f);
            brandSub.Location = new Point(32, 56);
            brand.Controls.Add(brandSub);

            Panel launchPanel = new Panel();
            launchPanel.Dock = DockStyle.Top;
            launchPanel.Height = 100;
            launchPanel.BackColor = UiColors.SideBg;

            launchCard = new LaunchCard();
            launchCard.SetBounds(16, 8, 228, 84);
            launchCard.Click += delegate { LaunchGenshin(); };
            launchPanel.Controls.Add(launchCard);

            Panel navPanel = new Panel();
            navPanel.Dock = DockStyle.Top;
            navPanel.Height = 270;
            navPanel.BackColor = UiColors.SideBg;

            Label navLabel = new Label();
            navLabel.AutoSize = true;
            navLabel.Text = "功能";
            navLabel.ForeColor = UiColors.TextFaint;
            navLabel.Font = new Font("Microsoft YaHei UI", 8f);
            navLabel.Location = new Point(30, 4);
            navPanel.Controls.Add(navLabel);

            AddNav(navPanel, "dashboard", "◈", "资源", 26);
            AddNav(navPanel, "wishes", "✧", "抽卡记录", 76);
            AddNav(navPanel, "collection", "✦", "收藏图鉴", 126);
            AddNav(navPanel, "stats", "◎", "统计", 176);
            AddNav(navPanel, "settings", "⚙", "设置", 226);
            navButtons["dashboard"].Active = true;

            // Dock=Top 按添加顺序反向排列：先加 nav / launch，最后加 brand，
            // 实际自上而下为 brand → launch → nav；游戏切换保留页面顶栏那一组
            sidebar.Controls.Add(navPanel);
            sidebar.Controls.Add(launchPanel);
            sidebar.Controls.Add(brand);

            Panel tipPanel = new Panel();
            tipPanel.Dock = DockStyle.Bottom;
            tipPanel.Height = 110;
            tipPanel.BackColor = UiColors.SideBg;
            tipPanel.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                float scale = g.DpiX / 96f;
                Rectangle card = new Rectangle((int)Math.Round(16 * scale),
                    (int)Math.Round(6 * scale),
                    (int)Math.Round(228 * scale), (int)Math.Round(96 * scale));
                using (GraphicsPath path = SideButton.RoundedRect(card,
                    (int)Math.Round(12 * scale)))
                using (SolidBrush brush = new SolidBrush(UiColors.SideSoft))
                {
                    g.FillPath(brush, path);
                }
                using (Pen pen = new Pen(Color.FromArgb(40, 46, 68)))
                using (GraphicsPath path = SideButton.RoundedRect(card,
                    (int)Math.Round(12 * scale)))
                {
                    g.DrawPath(pen, path);
                }

                using (Font titleFont = new Font("Microsoft YaHei UI", 8f, FontStyle.Bold))
                using (SolidBrush brush = new SolidBrush(UiColors.Gold))
                {
                    g.DrawString("小提示", titleFont, brush,
                        (int)Math.Round(30 * scale), (int)Math.Round(20 * scale));
                }
                using (Font textFont = new Font("Microsoft YaHei UI", 8f))
                using (SolidBrush brush = new SolidBrush(UiColors.TextDim))
                {
                    g.DrawString("识图弹窗支持原神实时画面", textFont, brush,
                        (int)Math.Round(30 * scale), (int)Math.Round(44 * scale));
                    g.DrawString("窗口化 / 无边框模式识别更稳定", textFont, brush,
                        (int)Math.Round(30 * scale), (int)Math.Round(66 * scale));
                }
            };
            sidebar.Controls.Add(tipPanel);

            Panel bottom = new Panel();
            bottom.Dock = DockStyle.Bottom;
            bottom.Height = 222;
            bottom.BackColor = UiColors.SideBg;
            sidebar.Controls.Add(bottom);

            AddSideAction(bottom, "打开数据目录", 10, OpenDataFolder);
            AddSideAction(bottom, "查看启动日志", 48, OpenLog);
            AddSideAction(bottom, "重启本地服务", 86, RestartService);
            AddSideAction(bottom, "刷新页面", 124, RefreshPage);
            AddSideAction(bottom, "检查更新", 162, CheckUpdate);

            string localVersion = ReadLocalVersion();
            versionLabel = new Label();
            versionLabel.AutoSize = false;
            versionLabel.Text = "v" + (localVersion.Length > 0 ? localVersion : "1.5.0")
                + " · 本地端口 " + Port;
            versionLabel.ForeColor = UiColors.TextFaint;
            versionLabel.Font = new Font("Microsoft YaHei UI", 8f);
            versionLabel.SetBounds(30, 198, 204, 20);
            bottom.Controls.Add(versionLabel);
        }

        private void AddNav(Panel parent, string view, string glyph, string text, int top)
        {
            SideButton button = new SideButton();
            button.Text = text;
            button.Glyph = glyph;
            button.GlyphWidth = 26;
            button.Font = new Font("Microsoft YaHei UI", 9.5f);
            button.SetBounds(14, top, 232, 44);
            button.Click += delegate { NavigateView(view); };
            parent.Controls.Add(button);
            navButtons[view] = button;
        }

        private void AddSideAction(Panel parent, string text, int top, EventHandler handler)
        {
            SideButton button = new SideButton();
            button.Text = text;
            button.Accent = true;
            button.GlyphWidth = 0;
            button.SetBounds(14, top, 232, 34);
            button.Font = new Font("Microsoft YaHei UI", 8.5f);
            button.Click += handler;
            parent.Controls.Add(button);
        }

        private void BuildWebView()
        {
            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.Visible = false;
            webView.DefaultBackgroundColor = UiColors.Bg;
            contentHost.Controls.Add(webView);
        }

        private void BuildLoadingPanel()
        {
            loadingPanel = new Panel();
            loadingPanel.Dock = DockStyle.Fill;
            loadingPanel.BackColor = UiColors.Bg;
            loadingPanel.Resize += delegate { CenterLoadingCard(); };
            contentHost.Controls.Add(loadingPanel);
            loadingPanel.BringToFront();

            loadingCard = new Panel();
            loadingCard.Size = new Size(520, 262);
            loadingCard.BackColor = UiColors.Bg;
            loadingCard.Paint += delegate(object sender, PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                float scale = g.DpiX / 96f;
                Rectangle rect = new Rectangle(0, 0, loadingCard.Width - 1, loadingCard.Height - 1);
                using (GraphicsPath path = SideButton.RoundedRect(rect,
                    (int)Math.Round(16 * scale)))
                using (SolidBrush brush = new SolidBrush(UiColors.Card))
                {
                    g.FillPath(brush, path);
                }
                using (Pen pen = new Pen(UiColors.Line))
                using (GraphicsPath path = SideButton.RoundedRect(rect,
                    (int)Math.Round(16 * scale)))
                {
                    g.DrawPath(pen, path);
                }
                using (Pen pen = new Pen(Color.FromArgb(150, 211, 188, 142),
                    Math.Max(1f, (float)Math.Round(scale))))
                {
                    g.DrawLine(pen, (int)Math.Round(26 * scale), 0,
                        (int)Math.Round(98 * scale), 0);
                }
            };
            loadingPanel.Controls.Add(loadingCard);

            loadingTitle = new Label();
            loadingTitle.AutoSize = false;
            loadingTitle.Text = "正在启动本地服务";
            loadingTitle.ForeColor = UiColors.GoldLight;
            loadingTitle.BackColor = UiColors.Card;
            loadingTitle.Font = new Font("Microsoft YaHei UI", 16f, FontStyle.Bold);
            loadingTitle.SetBounds(32, 28, 456, 36);
            loadingCard.Controls.Add(loadingTitle);

            loadingHint = new Label();
            loadingHint.AutoSize = false;
            loadingHint.Text = "首次启动需要加载数据与 OCR 组件，大约 10 秒。请稍候…";
            loadingHint.ForeColor = UiColors.TextDim;
            loadingHint.BackColor = UiColors.Card;
            loadingHint.Font = new Font("Microsoft YaHei UI", 9.5f);
            loadingHint.SetBounds(32, 72, 456, 46);
            loadingCard.Controls.Add(loadingHint);

            progressBar = new IndeterminateBar();
            progressBar.SetBounds(32, 128, 456, 6);
            loadingCard.Controls.Add(progressBar);

            errorLabel = new Label();
            errorLabel.AutoSize = false;
            errorLabel.Visible = false;
            errorLabel.ForeColor = UiColors.Red;
            errorLabel.BackColor = UiColors.Card;
            errorLabel.Font = new Font("Microsoft YaHei UI", 9f);
            errorLabel.SetBounds(32, 146, 456, 52);
            loadingCard.Controls.Add(errorLabel);

            errorActions = new Panel();
            errorActions.Visible = false;
            errorActions.SetBounds(32, 204, 456, 34);
            errorActions.BackColor = UiColors.Card;
            loadingCard.Controls.Add(errorActions);

            Button retry = new Button();
            retry.Text = "重新启动服务";
            retry.SetBounds(0, 0, 126, 32);
            retry.FlatStyle = FlatStyle.Flat;
            retry.FlatAppearance.BorderColor = UiColors.Gold;
            retry.BackColor = Color.FromArgb(30, 36, 54);
            retry.ForeColor = UiColors.GoldLight;
            retry.Font = new Font("Microsoft YaHei UI", 9f);
            retry.Cursor = Cursors.Hand;
            retry.Click += delegate { RestartService(null, EventArgs.Empty); };
            errorActions.Controls.Add(retry);

            Button log = new Button();
            log.Text = "查看日志";
            log.SetBounds(136, 0, 96, 32);
            log.FlatStyle = FlatStyle.Flat;
            log.FlatAppearance.BorderColor = UiColors.Line;
            log.BackColor = Color.FromArgb(20, 24, 39);
            log.ForeColor = UiColors.Text;
            log.Font = new Font("Microsoft YaHei UI", 9f);
            log.Cursor = Cursors.Hand;
            log.Click += delegate { OpenLog(null, EventArgs.Empty); };
            errorActions.Controls.Add(log);

            Button quit = new Button();
            quit.Text = "退出启动器";
            quit.SetBounds(242, 0, 96, 32);
            quit.FlatStyle = FlatStyle.Flat;
            quit.FlatAppearance.BorderColor = UiColors.Line;
            quit.BackColor = Color.FromArgb(20, 24, 39);
            quit.ForeColor = UiColors.TextDim;
            quit.Font = new Font("Microsoft YaHei UI", 9f);
            quit.Cursor = Cursors.Hand;
            quit.Click += delegate { Close(); };
            errorActions.Controls.Add(quit);
        }

        private void CenterLoadingCard()
        {
            if (loadingPanel == null || loadingCard == null)
            {
                return;
            }
            loadingCard.Left = Math.Max(0, (loadingPanel.ClientSize.Width - loadingCard.Width) / 2);
            loadingCard.Top = Math.Max(0, (loadingPanel.ClientSize.Height - loadingCard.Height) / 2);
        }

        /* ------------------------------ 服务 ------------------------------ */

        /// <summary>
        /// JWT 密钥：优先使用环境变量 SA_JWT_SECRET；否则在 data/jwt.secret 生成并复用，
        /// 保证每个安装实例都有独立的随机密钥，也不会把密钥写进仓库。
        /// </summary>
        private string ResolveJwtSecret()
        {
            string env = Environment.GetEnvironmentVariable("SA_JWT_SECRET");
            if (!string.IsNullOrEmpty(env) && env.Trim().Length >= 32)
            {
                return env.Trim();
            }
            string path = Path.Combine(dataDir, "jwt.secret");
            try
            {
                if (File.Exists(path))
                {
                    string saved = File.ReadAllText(path).Trim();
                    if (saved.Length >= 32)
                    {
                        return saved;
                    }
                }
                byte[] bytes = new byte[48];
                using (System.Security.Cryptography.RNGCryptoServiceProvider rng =
                       new System.Security.Cryptography.RNGCryptoServiceProvider())
                {
                    rng.GetBytes(bytes);
                }
                string secret = Convert.ToBase64String(bytes);
                File.WriteAllText(path, secret);
                AppendLog("已生成本机 JWT 密钥：" + path);
                return secret;
            }
            catch (Exception ex)
            {
                AppendLog("生成 JWT 密钥失败：" + ex.Message);
                return null;
            }
        }

        private void StartService(bool restarting)
        {
            if (closing)
            {
                return;
            }

            Directory.CreateDirectory(dataDir);
            string jarPath = Path.Combine(baseDir, JarFileName);
            string javaPath = Path.Combine(baseDir, Path.Combine("jre", Path.Combine("bin", "java.exe")));

            if (!File.Exists(jarPath))
            {
                ShowError("缺少南空提瓦特小助手.jar，请确认整个绿色版文件夹完整。");
                return;
            }
            if (!File.Exists(javaPath))
            {
                ShowError("缺少内置 Java 运行环境（jre\\bin\\java.exe），请重新解压完整绿色版。");
                return;
            }
            if (PortOpen(Port))
            {
                ShowError("端口 " + Port + " 已被占用，请先关闭其它南空提瓦特小助手或占用该端口的程序。");
                return;
            }

            ticks = 0;
            serviceReady = false;
            SetStatus(restarting ? "正在重启本地服务…" : "正在启动本地服务…", UiColors.Gold, true);
            loadingPanel.Visible = true;
            loadingPanel.BringToFront();
            webView.Visible = false;
            loadingTitle.Text = restarting ? "正在重启本地服务" : "正在启动本地服务";
            loadingHint.Text = "首次启动需要加载数据与 OCR 组件，大约 10 秒。请稍候…";
            loadingHint.Visible = true;
            progressBar.Visible = true;
            errorLabel.Visible = false;
            errorActions.Visible = false;

            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = javaPath;
                info.Arguments = "-Xms64m -Xmx512m -Dfile.encoding=UTF-8 -jar \"" + jarPath
                    + "\" --server.port=" + Port;
                info.WorkingDirectory = baseDir;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;

                string tesseractDir = Path.Combine(baseDir, "tesseract");
                string tesseractCmd = Path.Combine(tesseractDir, "tesseract.exe");
                if (File.Exists(tesseractCmd))
                {
                    info.EnvironmentVariables["SA_TESSERACT_CMD"] = tesseractCmd;
                    // Tesseract 5 的 TESSDATA_PREFIX 必须指向 tessdata 目录本身
                    info.EnvironmentVariables["TESSDATA_PREFIX"] =
                        Path.Combine(tesseractDir, "tessdata");
                }

                // 后端不再内置默认 JWT 密钥：由启动器注入本机随机密钥（或外部 SA_JWT_SECRET）
                string jwtSecret = ResolveJwtSecret();
                if (jwtSecret != null)
                {
                    info.EnvironmentVariables["SA_JWT_SECRET"] = jwtSecret;
                }

                AppendLog("启动本地服务：\"" + javaPath + "\" " + info.Arguments);
                javaProcess = Process.Start(info);
                javaProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) AppendLog("[服务] " + e.Data);
                };
                javaProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) AppendLog("[错误] " + e.Data);
                };
                javaProcess.BeginOutputReadLine();
                javaProcess.BeginErrorReadLine();

                pollTimer.Start();
            }
            catch (Exception ex)
            {
                ShowError("启动本地服务失败：" + ex.Message);
            }
        }

        private void PollTimer_Tick(object sender, EventArgs e)
        {
            ticks += 1;

            if (javaProcess != null && javaProcess.HasExited)
            {
                ShowError("本地服务已退出（退出码 " + javaProcess.ExitCode + "）。");
                return;
            }

            if (serviceReady)
            {
                if (ticks % 10 == 0)
                {
                    SetStatus("本地服务运行中 · 端口 " + Port, UiColors.Green, false);
                }
                return;
            }

            if (PortOpen(Port))
            {
                serviceReady = true;
                pollTimer.Stop();
                SetStatus("本地服务运行中 · 端口 " + Port, UiColors.Green, false);
                AppendLog("本地服务就绪，正在打开内嵌界面。");
                ShowWeb();
                return;
            }

            if (ticks >= MaxTicks)
            {
                ShowError("启动超时（约 96 秒）。请查看日志，确认端口未被占用、data 目录可写。");
                return;
            }

            if (ticks % 5 == 0)
            {
                loadingHint.Text = "正在等待本地服务就绪… 已等待 " + (ticks * 400 / 1000) + " 秒";
            }
        }

        private void ShowWeb()
        {
            loadingPanel.Visible = false;
            webView.Visible = true;
            if (webInitialized)
            {
                NavigateService();
                return;
            }
            InitWebView(true);
        }

        /** 页面就绪前先在后台把 WebView2 预加载好，缩短「等待本地服务」后的空白期 */
        private void PrepareWebView()
        {
            InitWebView(false);
        }

        private void NavigateService()
        {
            try
            {
                webView.CoreWebView2.Navigate(ServiceUrl);
            }
            catch
            {
                // 忽略导航异常，交由 WebView2 的事件提示
            }
        }

        private async void InitWebView(bool navigate)
        {
            if (webInitialized)
            {
                if (navigate)
                {
                    NavigateService();
                }
                return;
            }
            try
            {
                string userData = Path.Combine(dataDir, "webview2");
                Directory.CreateDirectory(userData);
                coreEnvironment = await CoreWebView2Environment.CreateAsync(null, userData, null);
                await webView.EnsureCoreWebView2Async(coreEnvironment);

                webInitialized = true;
                CoreWebView2 core = webView.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                core.Settings.IsZoomControlEnabled = true;
                core.Settings.IsSwipeNavigationEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Settings.IsBuiltInErrorPageEnabled = false;
                webView.ZoomFactor = 1.0;
                core.NavigationCompleted += WebView_NavigationCompleted;
                core.ProcessFailed += WebView_ProcessFailed;
                core.WebMessageReceived += WebView_WebMessageReceived;

                if (navigate)
                {
                    webView.Visible = true;
                    loadingPanel.Visible = false;
                    NavigateService();
                    AppendLog("WebView2 已初始化，加载 " + ServiceUrl);
                }
                else
                {
                    AppendLog("WebView2 已预加载，等待本地服务就绪");
                }
            }
            catch (Exception ex)
            {
                if (navigate)
                {
                    ShowError("内嵌界面初始化失败：" + ex.Message
                        + "\n请安装 Microsoft Edge WebView2 Runtime 后重试（Windows 10/11 通常已自带）。");
                }
                else
                {
                    AppendLog("WebView2 预加载失败：" + ex.Message);
                }
            }
        }

        private async void WebView_NavigationCompleted(object sender,
            CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                SetStatus("页面加载失败：" + e.WebErrorStatus, UiColors.Red, true);
                return;
            }

            try
            {
                string css = "(function(){if(document.getElementById('launcher-shell')){return;}"
                    + "var s=document.createElement('style');s.id='launcher-shell';"
                    + "s.textContent='.topbar .brand.brand-sm{display:none!important}'"
                    + "+'.topbar .nav{display:none!important}'"
                    + "+'.topbar-inner{padding-left:22px!important}'"
                    + "+'.tabbar{display:none!important}'"
                    // 毛玻璃滤镜在嵌入窗口里开销明显，去掉后滚动更跟手
                    + "+'.topbar,.modal-mask,.tabbar{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';"
                    + "document.head.appendChild(s);})();";
                await webView.ExecuteScriptAsync(css);
            }
            catch
            {
                // 注入失败不影响页面本身
            }
        }

        private void WebView_ProcessFailed(object sender,
            CoreWebView2ProcessFailedEventArgs e)
        {
            SetStatus("内嵌页面进程异常，请点击「重启本地服务」", UiColors.Red, true);
        }

        /* ---------------- 抓取原神窗口 ---------------- */

        /** 识图弹窗打开期间的实时抓图定时器；关闭弹窗后立即停止 */
        private System.Windows.Forms.Timer liveCaptureTimer;
        private bool liveCaptureStopped;
        private bool liveCaptureWindowLogged;
        private int liveCaptureMisses;

        private void WebView_WebMessageReceived(object sender,
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message = e.WebMessageAsJson;
            if (message == null)
            {
                return;
            }
            if (message.IndexOf("captureLiveStart", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                StartLiveCapture();
            }
            else if (message.IndexOf("captureLiveStop", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                StopLiveCapture();
            }
            else if (message.IndexOf("captureGame", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                CaptureGameWindow();
            }
        }

        /// <summary>抓取原神窗口画面，转成 JPEG data URL 回传给页面做资源识别。</summary>
        private void CaptureGameWindow()
        {
            try
            {
                IntPtr handle = FindGameWindow();
                if (handle == IntPtr.Zero)
                {
                    PostCaptureError("没有找到原神窗口，请先启动游戏（需窗口化或无边框模式）");
                    return;
                }
                if (IsIconic(handle))
                {
                    PostCaptureError("原神窗口已最小化，请先还原窗口再抓取");
                    return;
                }

                RECT rect;
                if (!GetWindowRect(handle, out rect))
                {
                    PostCaptureError("读取原神窗口位置失败");
                    return;
                }
                int width = rect.Right - rect.Left;
                int height = rect.Bottom - rect.Top;
                if (width <= 0 || height <= 0 || width > 8000 || height > 5000)
                {
                    PostCaptureError("原神窗口尺寸异常，请切换为窗口化模式后重试");
                    return;
                }

                using (Bitmap bitmap = new Bitmap(width, height))
                {
                    bool printed = false;
                    using (Graphics graphics = Graphics.FromImage(bitmap))
                    {
                        IntPtr hdc = graphics.GetHdc();
                        try
                        {
                            printed = PrintWindow(handle, hdc, 2);
                        }
                        finally
                        {
                            graphics.ReleaseHdc(hdc);
                        }
                    }

                    if (!printed || IsBlank(bitmap))
                    {
                        // 独占全屏或 DWM 不返回画面时，退化为抓取屏幕对应区域
                        SetForegroundWindow(handle);
                        Thread.Sleep(350);
                        using (Graphics graphics = Graphics.FromImage(bitmap))
                        {
                            graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0,
                                new Size(width, height));
                        }
                        if (IsBlank(bitmap))
                        {
                            PostCaptureError("抓取到的是黑屏，请把原神切换为窗口化或无边框模式后再试");
                            return;
                        }
                    }

                    using (MemoryStream stream = new MemoryStream())
                    {
                        ImageCodecInfo jpeg = FindJpegCodec();
                        EncoderParameters options = new EncoderParameters(1);
                        options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
                        bitmap.Save(stream, jpeg, options);
                        string base64 = Convert.ToBase64String(stream.ToArray());
                        PostLauncherJson("{\"action\":\"gameCapture\","
                            + "\"dataUrl\":\"data:image/jpeg;base64," + base64 + "\"}");
                    }
                    SetStatus("已抓取原神窗口，正在识别资源…", UiColors.Gold, false);
                }
            }
            catch (Exception ex)
            {
                PostCaptureError("抓取原神窗口失败：" + ex.Message);
            }
        }

        /* ---------------- 实时抓图（识图弹窗打开期间每秒一帧） ---------------- */

        private void StartLiveCapture()
        {
            StopLiveCapture();
            liveCaptureStopped = false;
            liveCaptureWindowLogged = false;
            liveCaptureMisses = 0;
            liveCaptureTimer = new System.Windows.Forms.Timer();
            liveCaptureTimer.Interval = 1000;
            liveCaptureTimer.Tick += delegate { CaptureLiveFrame(); };
            liveCaptureTimer.Start();
            SetStatus("实时识图中，正在抓取原神画面…", UiColors.Gold, false);
            CaptureLiveFrame();
        }

        private void StopLiveCapture()
        {
            if (liveCaptureTimer != null)
            {
                liveCaptureTimer.Stop();
                liveCaptureTimer.Dispose();
                liveCaptureTimer = null;
            }
        }

        /// <summary>实时预览只走 PrintWindow，不抢焦点；独占全屏通常抓不到，会提示切换窗口化。</summary>
        private void CaptureLiveFrame()
        {
            if (liveCaptureStopped)
            {
                return;
            }
            try
            {
                IntPtr handle = FindGameWindow();
                if (handle == IntPtr.Zero)
                {
                    liveCaptureMisses++;
                    if (liveCaptureMisses < 15)
                    {
                        SetStatus("等待原神窗口…（请进入游戏画面）", UiColors.Gold, false);
                        return;
                    }
                    AppendLog("[抓图] 没有找到原神窗口；匹配进程：" + DescribeGenshinProcesses());
                    FailLiveCapture("没有找到原神窗口，请先进入游戏画面（需窗口化或无边框模式）");
                    return;
                }
                if (!liveCaptureWindowLogged)
                {
                    uint pid;
                    GetWindowThreadProcessId(handle, out pid);
                    AppendLog("[抓图] 找到原神窗口 PID " + pid);
                    liveCaptureWindowLogged = true;
                }
                if (IsIconic(handle))
                {
                    liveCaptureMisses++;
                    if (liveCaptureMisses < 15)
                    {
                        SetStatus("原神窗口已最小化，等待窗口还原…", UiColors.Gold, false);
                        return;
                    }
                    FailLiveCapture("原神窗口已最小化，请先还原窗口再识图");
                    return;
                }
                liveCaptureMisses = 0;

                Bitmap bitmap = CaptureGameBitmap(handle);
                if (bitmap == null)
                {
                    FailLiveCapture("读取原神画面失败，请把游戏切换为窗口化或无边框模式后重试");
                    return;
                }
                using (bitmap)
                {
                    if (IsBlank(bitmap))
                    {
                        FailLiveCapture("无法实时抓取原神画面，请把游戏切换为窗口化或无边框模式（独占全屏不支持实时预览）");
                        return;
                    }

                    using (MemoryStream stream = new MemoryStream())
                    {
                        ImageCodecInfo jpeg = FindJpegCodec();
                        EncoderParameters options = new EncoderParameters(1);
                        options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
                        bitmap.Save(stream, jpeg, options);
                        string base64 = Convert.ToBase64String(stream.ToArray());
                        PostLauncherJson("{\"action\":\"gameCaptureFrame\","
                            + "\"dataUrl\":\"data:image/jpeg;base64," + base64 + "\"}");
                    }
                }
            }
            catch (Exception ex)
            {
                FailLiveCapture("实时抓取原神窗口失败：" + ex.Message);
            }
        }

        private void FailLiveCapture(string text)
        {
            liveCaptureStopped = true;
            StopLiveCapture();
            string safe = text.Replace("\\", "\\\\").Replace("\"", "\\\"");
            PostLauncherJson("{\"action\":\"gameCaptureError\",\"live\":true,\"message\":\""
                + safe + "\"}");
            SetStatus(text, UiColors.Red, true);
        }

        private IntPtr FindGameWindow()
        {
            Process[] processes;
            try
            {
                processes = Process.GetProcesses();
            }
            catch
            {
                return IntPtr.Zero;
            }

            IntPtr best = IntPtr.Zero;
            int bestArea = 0;
            int selfId = Process.GetCurrentProcess().Id;

            // 先按已知的游戏进程名查找，避免读取 ProcessName 时因权限不足被跳过
            string[] knownNames = { "YuanShen", "GenshinImpact", "Genshin Impact" };
            foreach (string knownName in knownNames)
            {
                Process[] named;
                try
                {
                    named = Process.GetProcessesByName(knownName);
                }
                catch
                {
                    continue;
                }
                foreach (Process process in named)
                {
                    try
                    {
                        if (process.Id != selfId)
                        {
                            CheckGameProcess(process, ref best, ref bestArea);
                        }
                    }
                    catch
                    {
                        // 进程退出或无权限时忽略
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            if (best != IntPtr.Zero)
            {
                return best;
            }

            // 兜底：只匹配 yuanshen / genshinimpact，并排除启动器自身（南空提瓦特小助手）
            foreach (Process process in processes)
            {
                try
                {
                    if (process.Id == selfId)
                    {
                        continue;
                    }
                    string name;
                    try
                    {
                        name = process.ProcessName.ToLowerInvariant();
                    }
                    catch
                    {
                        continue;
                    }
                    if (name.Contains("southair") || name.Contains("南空提瓦特小助手"))
                    {
                        continue;
                    }
                    if (!name.Contains("yuanshen") && !name.Contains("genshinimpact"))
                    {
                        continue;
                    }
                    CheckGameProcess(process, ref best, ref bestArea);
                }
                catch
                {
                    // 进程退出或无权限时忽略
                }
                finally
                {
                    process.Dispose();
                }
            }
            return best;
        }

        /** 取进程面积最大的可见窗口；MainWindowHandle 为 0 时也能兜底。 */
        private void CheckGameProcess(Process process, ref IntPtr best, ref int bestArea)
        {
            IntPtr handle = FindLargestWindow(process.Id);
            if (handle == IntPtr.Zero)
            {
                handle = process.MainWindowHandle;
            }
            if (handle == IntPtr.Zero)
            {
                return;
            }
            RECT rect;
            if (!GetWindowRect(handle, out rect))
            {
                return;
            }
            int area = (rect.Right - rect.Left) * (rect.Bottom - rect.Top);
            if (area > bestArea)
            {
                bestArea = area;
                best = handle;
            }
        }

        /** 用 BitBlt 从窗口客户区抓取画面；对原神的 DirectX 窗口比 PrintWindow 可靠。 */
        private Bitmap CaptureGameBitmap(IntPtr handle)
        {
            RECT rect;
            if (!GetClientRect(handle, out rect))
            {
                return null;
            }
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0 || width > 8000 || height > 5000)
            {
                return null;
            }

            IntPtr srcDc = IntPtr.Zero;
            IntPtr memDc = IntPtr.Zero;
            IntPtr bmp = IntPtr.Zero;
            try
            {
                srcDc = GetDC(handle);
                if (srcDc == IntPtr.Zero)
                {
                    return null;
                }
                memDc = CreateCompatibleDC(srcDc);
                if (memDc == IntPtr.Zero)
                {
                    return null;
                }
                bmp = CreateCompatibleBitmap(srcDc, width, height);
                if (bmp == IntPtr.Zero)
                {
                    return null;
                }
                SelectObject(memDc, bmp);
                if (!BitBlt(memDc, 0, 0, width, height, srcDc, 0, 0, SrcCopy))
                {
                    return null;
                }

                Bitmap bitmap = new Bitmap(width, height);
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    IntPtr hdc = graphics.GetHdc();
                    try
                    {
                        BitBlt(hdc, 0, 0, width, height, memDc, 0, 0, SrcCopy);
                    }
                    finally
                    {
                        graphics.ReleaseHdc(hdc);
                    }
                }
                return bitmap;
            }
            finally
            {
                if (bmp != IntPtr.Zero)
                {
                    DeleteObject(bmp);
                }
                if (memDc != IntPtr.Zero)
                {
                    DeleteDC(memDc);
                }
                if (srcDc != IntPtr.Zero)
                {
                    ReleaseDC(handle, srcDc);
                }
            }
        }

        /** 枚举属于指定进程的可见顶层窗口，返回面积最大的一个。 */
        private IntPtr FindLargestWindow(int processId)
        {
            IntPtr best = IntPtr.Zero;
            int bestArea = 0;
            EnumWindows(delegate(IntPtr handle, IntPtr lParam)
            {
                uint pid;
                GetWindowThreadProcessId(handle, out pid);
                if ((int)pid != processId || !IsWindowVisible(handle))
                {
                    return true;
                }
                RECT rect;
                if (!GetWindowRect(handle, out rect))
                {
                    return true;
                }
                int width = rect.Right - rect.Left;
                int height = rect.Bottom - rect.Top;
                if (width <= 0 || height <= 0)
                {
                    return true;
                }
                int area = width * height;
                if (area > bestArea)
                {
                    bestArea = area;
                    best = handle;
                }
                return true;
            }, IntPtr.Zero);
            return best;
        }

        /** 抓图失败时把当前匹配到的原神相关进程写进日志，便于排查。 */
        private string DescribeGenshinProcesses()
        {
            List<string> names = new List<string>();
            int selfId = Process.GetCurrentProcess().Id;
            try
            {
                foreach (Process process in Process.GetProcesses())
                {
                    try
                    {
                        if (process.Id == selfId)
                        {
                            continue;
                        }
                        string name = process.ProcessName;
                        string lower = name.ToLowerInvariant();
                        if (lower.Contains("southair") || lower.Contains("南空提瓦特小助手"))
                        {
                            continue;
                        }
                        if (lower.Contains("yuanshen") || lower.Contains("genshinimpact"))
                        {
                            names.Add(name + "(" + process.Id + ")");
                        }
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            catch
            {
                // 忽略枚举失败
            }
            return names.Count > 0 ? string.Join(", ", names.ToArray()) : "无";
        }

        /// <summary>PrintWindow 失败时通常得到整幅纯黑，用采样比例判断。</summary>
        private bool IsBlank(Bitmap bitmap)
        {
            int stepX = Math.Max(1, bitmap.Width / 24);
            int stepY = Math.Max(1, bitmap.Height / 16);
            int total = 0;
            int dark = 0;
            int bright = 0;
            for (int y = 0; y < bitmap.Height; y += stepY)
            {
                for (int x = 0; x < bitmap.Width; x += stepX)
                {
                    Color color = bitmap.GetPixel(x, y);
                    total++;
                    if (color.R < 10 && color.G < 10 && color.B < 10)
                    {
                        dark++;
                    }
                    else if (color.R > 245 && color.G > 245 && color.B > 245)
                    {
                        bright++;
                    }
                }
            }
            return total > 0 && (dark * 100 / total >= 97 || bright * 100 / total >= 97);
        }

        private ImageCodecInfo FindJpegCodec()
        {
            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders())
            {
                if (codec.FormatID == ImageFormat.Jpeg.Guid)
                {
                    return codec;
                }
            }
            return ImageCodecInfo.GetImageEncoders()[0];
        }

        private void PostLauncherJson(string json)
        {
            if (!webInitialized)
            {
                return;
            }
            try
            {
                webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch
            {
                // 页面已关闭时忽略
            }
        }

        private void PostCaptureError(string text)
        {
            string safe = text.Replace("\\", "\\\\").Replace("\"", "\\\"");
            PostLauncherJson("{\"action\":\"gameCaptureError\",\"message\":\"" + safe + "\"}");
            SetStatus(text, UiColors.Red, true);
        }

        private async void NavigateView(string view)
        {
            if (!webInitialized)
            {
                return;
            }
            try
            {
                string script = "(function(){return window.SG_LAUNCHER ? SG_LAUNCHER.nav('"
                    + view + "') : false;})()";
                string result = await webView.ExecuteScriptAsync(script);
                if (result == "true")
                {
                    SetActiveNav(view);
                }
            }
            catch
            {
                // 页面尚未登录或正在刷新时忽略
            }
        }

        private void SetActiveNav(string view)
        {
            foreach (KeyValuePair<string, SideButton> entry in navButtons)
            {
                entry.Value.Active = entry.Key == view;
                entry.Value.Invalidate();
            }
        }

        private void SetStatus(string text, Color color, bool starting)
        {
            if (statusText == null)
            {
                return;
            }
            statusText.Text = text;
            statusText.ForeColor = starting ? color : UiColors.TextDim;
            statusDot.ForeColor = color;
        }

        private void ShowError(string message)
        {
            if (closing)
            {
                return;
            }
            pollTimer.Stop();
            serviceReady = false;
            SetStatus("启动失败", UiColors.Red, true);
            loadingPanel.Visible = true;
            loadingPanel.BringToFront();
            webView.Visible = false;
            loadingTitle.Text = "启动失败";
            loadingHint.Visible = false;
            progressBar.Visible = false;
            errorLabel.Visible = true;
            errorLabel.Text = message + Environment.NewLine + Environment.NewLine + TailLog(6);
            errorActions.Visible = true;
            loadingCard.Height = 260;
            CenterLoadingCard();
            AppendLog("启动失败：" + message);
            KillJava();
        }

        private void RestartService(object sender, EventArgs e)
        {
            if (webInitialized)
            {
                try
                {
                    webView.CoreWebView2.Navigate("about:blank");
                }
                catch
                {
                    // 忽略
                }
            }
            KillJava();
            StartService(true);
        }

        private void RefreshPage(object sender, EventArgs e)
        {
            if (webInitialized && serviceReady)
            {
                try
                {
                    webView.CoreWebView2.Reload();
                }
                catch
                {
                    // 忽略
                }
            }
        }

        /* ---------------- 检查更新 ---------------- */

        private string LocalVersionPath
        {
            get { return Path.Combine(baseDir, "version.json"); }
        }

        private string ReadLocalVersion()
        {
            return ReadLocalVersionField("\"version\"\\s*:\\s*\"([^\"]+)\"");
        }

        private string ReadLocalCommit()
        {
            return ReadLocalVersionField("\"commit\"\\s*:\\s*\"([a-fA-F0-9]+)\"");
        }

        private string ReadLocalVersionField(string pattern)
        {
            try
            {
                if (!File.Exists(LocalVersionPath))
                {
                    return "";
                }
                string json = File.ReadAllText(LocalVersionPath, Encoding.UTF8);
                Match match = Regex.Match(json, pattern);
                return match.Success ? match.Groups[1].Value : "";
            }
            catch
            {
                return "";
            }
        }

        private void WriteLocalVersion(string commit)
        {
            try
            {
                string version = ReadLocalVersion();
                if (version.Length == 0)
                {
                    version = "1.5.0";
                }
                string json = "{\"version\":\"" + version + "\",\"commit\":\"" + commit
                    + "\",\"built\":\"" + DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ssK") + "\"}";
                File.WriteAllText(LocalVersionPath, json, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                AppendLog("写入 version.json 失败：" + ex.Message);
            }
        }

        private static string ShortCommit(string commit)
        {
            return commit.Length > 7 ? commit.Substring(0, 7) : commit;
        }

        /** 本地与 Release 标签都按短提交号比较，避免长度与大小写差异 */
        private static bool SameCommit(string local, string remote)
        {
            if (local.Length == 0 || remote.Length == 0)
            {
                return false;
            }
            int length = Math.Min(7, Math.Min(local.Length, remote.Length));
            return string.Equals(local.Substring(0, length), remote.Substring(0, length),
                StringComparison.OrdinalIgnoreCase);
        }

        private void ResetStatus()
        {
            if (serviceReady)
            {
                SetStatus("本地服务运行中 · 端口 " + Port, UiColors.Green, false);
            }
            else
            {
                SetStatus("正在启动本地服务…", UiColors.Gold, true);
            }
        }

        /** 读取 GitHub 最新 Release：标签为 build-<commit>，资产为南空提瓦特小助手.jar */
        private static ReleaseInfo FetchLatestRelease()
        {
            try
            {
                // 旧版 .NET Framework 默认可能不带 TLS 1.2，GitHub API 会直接断开
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            }
            catch
            {
                // 不支持时保持默认协议
            }
            using (WebClient client = new WebClient())
            {
                client.Headers["User-Agent"] = UpdateUserAgent;
                client.Headers["Accept"] = "application/vnd.github+json";
                string json = client.DownloadString(RepoLatestRelease);

                ReleaseInfo info = new ReleaseInfo();
                Match tag = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"([^\"]+)\"");
                if (tag.Success)
                {
                    info.Tag = tag.Groups[1].Value;
                }
                if (!info.Tag.StartsWith("build-", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("最新 Release 标签不是 build-<commit> 格式");
                }
                info.Commit = info.Tag.Substring("build-".Length);

                /* 资产名可能包含中文，browser_download_url 是百分号编码，所以只按 .jar 后缀匹配 */
                Match asset = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"([^\"]+\\.jar)\"");
                if (!asset.Success)
                {
                    throw new InvalidOperationException("最新 Release 中没有 .jar 资产");
                }
                info.AssetUrl = asset.Groups[1].Value;
                return info;
            }
        }

        private static void DownloadJar(string url, string target)
        {
            using (WebClient client = new WebClient())
            {
                client.Headers["User-Agent"] = UpdateUserAgent;
                client.DownloadFile(url, target);
            }
        }

        /** Spring Boot 的可执行 jar 本身就是 zip，能打开即可视为下载完整 */
        private static bool IsValidJar(string path)
        {
            try
            {
                if (!File.Exists(path) || new FileInfo(path).Length < 1024 * 1024)
                {
                    return false;
                }
                using (System.IO.Compression.ZipArchive archive =
                    System.IO.Compression.ZipFile.OpenRead(path))
                {
                    return archive.Entries.Count > 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private async void CheckUpdate(object sender, EventArgs e)
        {
            if (updateBusy)
            {
                return;
            }
            updateBusy = true;
            bool applied = false;
            try
            {
                SetStatus("正在检查更新…", UiColors.Gold, true);
                ReleaseInfo release = await Task.Run(() => FetchLatestRelease());
                string localCommit = ReadLocalCommit();

                if (SameCommit(localCommit, release.Commit))
                {
                    MessageBox.Show(this,
                        "当前已是最新版本。" + Environment.NewLine + Environment.NewLine
                            + "本地提交：" + ShortCommit(localCommit) + Environment.NewLine
                            + "最新发布：" + release.Tag,
                        "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                string localText = localCommit.Length > 0
                    ? ShortCommit(localCommit) : "未记录（旧版绿色包）";
                DialogResult answer = MessageBox.Show(this,
                    "发现新版本：" + release.Tag + Environment.NewLine
                        + "本地提交：" + localText + " → 最新提交：" + ShortCommit(release.Commit)
                        + Environment.NewLine + Environment.NewLine
                        + "将下载新的南空提瓦特小助手.jar 并替换，随后自动重启本地服务；"
                        + "data 目录与配置都会保留。" + Environment.NewLine + Environment.NewLine
                        + "现在下载并更新吗？",
                    "发现新版本", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer != DialogResult.Yes)
                {
                    return;
                }

                string temp = Path.Combine(baseDir, JarFileName + ".new");
                if (File.Exists(temp))
                {
                    File.Delete(temp);
                }
                SetStatus("正在下载更新…", UiColors.Gold, true);
                await Task.Run(delegate { DownloadJar(release.AssetUrl, temp); });
                if (!IsValidJar(temp))
                {
                    File.Delete(temp);
                    throw new InvalidOperationException("下载的 jar 校验失败，请稍后重试");
                }

                ApplyJarUpdate(temp, release);
                applied = true;
            }
            catch (WebException ex)
            {
                AppendLog("检查更新失败：" + ex.Message);
                MessageBox.Show(this,
                    "检查更新失败：" + ex.Message + Environment.NewLine + Environment.NewLine
                        + "如果 GitHub 仓库尚未设为公开，匿名访问会返回 404；"
                        + "把仓库改为 Public 后再试即可。",
                    "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            catch (Exception ex)
            {
                AppendLog("检查更新失败：" + ex.Message);
                MessageBox.Show(this, "检查更新失败：" + ex.Message,
                    "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                updateBusy = false;
                if (!applied)
                {
                    ResetStatus();
                }
            }
        }

        /** 替换 jar 前先停服务并备份旧文件，替换失败时回滚到旧版本 */
        private void ApplyJarUpdate(string tempPath, ReleaseInfo release)
        {
            string jarPath = Path.Combine(baseDir, JarFileName);
            string backupPath = jarPath + ".bak";
            KillJava();
            try
            {
                if (File.Exists(jarPath))
                {
                    File.Copy(jarPath, backupPath, true);
                    File.Delete(jarPath);
                }
                File.Move(tempPath, jarPath);
            }
            catch
            {
                try
                {
                    if (!File.Exists(jarPath) && File.Exists(backupPath))
                    {
                        File.Copy(backupPath, jarPath, true);
                    }
                }
                catch
                {
                    // 回滚失败时由上层提示，避免掩盖原始错误
                }
                throw;
            }

            WriteLocalVersion(release.Commit);
            AppendLog("已更新到 " + release.Tag + "，旧 jar 备份为 " + Path.GetFileName(backupPath));
            SetStatus("更新完成，正在重启本地服务…", UiColors.Gold, true);
            RestartService(null, EventArgs.Empty);
        }

        private sealed class ReleaseInfo
        {
            public string Tag = "";
            public string Commit = "";
            public string AssetUrl = "";
        }

        /* ---------------- 启动原神 ---------------- */

        private static readonly string[] GameExeNames = { "YuanShen.exe", "GenshinImpact.exe" };

        /** 启动原神：先用上次保存的路径，找不到就自动搜索，再找不到让用户手动选 */
        private async void LaunchGenshin()
        {
            string path = LoadGamePath();
            if (path == null || !File.Exists(path))
            {
                SetStatus("正在搜索原神安装目录…", UiColors.Gold, false);
                Cursor = Cursors.WaitCursor;
                try
                {
                    path = await Task.Run(() => FindGenshinExe());
                }
                finally
                {
                    Cursor = Cursors.Default;
                }
                if (path == null)
                {
                    SetStatus("未自动找到原神，请手动选择游戏程序", UiColors.Gold, false);
                    path = AskGameExe();
                    if (path == null)
                    {
                        return;
                    }
                }
                SaveGamePath(path);
            }

            try
            {
                ProcessStartInfo info = new ProcessStartInfo(path);
                info.WorkingDirectory = Path.GetDirectoryName(path);
                info.UseShellExecute = true;
                Process.Start(info);
                AppendLog("启动原神：" + path);
                SetStatus("已启动原神 · " + Path.GetFileName(path), UiColors.Green, false);
            }
            catch (Exception ex)
            {
                SetStatus("启动原神失败：" + ex.Message, UiColors.Red, true);
                SaveGamePath(null);
            }
        }

        private string GamePathFile()
        {
            return Path.Combine(dataDir, "genshin-path.txt");
        }

        private string LoadGamePath()
        {
            try
            {
                string file = GamePathFile();
                if (!File.Exists(file))
                {
                    return null;
                }
                string text = File.ReadAllText(file, Encoding.UTF8).Trim();
                return text.Length == 0 ? null : text;
            }
            catch
            {
                return null;
            }
        }

        private void SaveGamePath(string path)
        {
            try
            {
                string file = GamePathFile();
                if (path == null)
                {
                    if (File.Exists(file))
                    {
                        File.Delete(file);
                    }
                    return;
                }
                Directory.CreateDirectory(dataDir);
                File.WriteAllText(file, path, Encoding.UTF8);
            }
            catch
            {
                // 保存失败不影响本次启动
            }
        }

        /** 注册表（米哈游 / HoYoPlay）与各盘常见安装目录，只检查固定路径，不做全盘递归 */
        private string FindGenshinExe()
        {
            string fromRegistry = FindGenshinInRegistry();
            if (fromRegistry != null)
            {
                return fromRegistry;
            }
            foreach (string dir in CandidateGameDirs())
            {
                string hit = ProbeGameDir(dir);
                if (hit != null)
                {
                    return hit;
                }
            }
            // 常见目录都没有时，再做一次限深搜索（装在自定义目录里的情况）
            return ScanDrivesForGame();
        }

        private const int ScanMaxDepth = 4;
        private const int ScanBudgetMs = 8000;

        /** 限深扫描时跳过的系统/大型目录，避免拖慢或陷入无意义遍历 */
        private static readonly HashSet<string> ScanSkip = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "Windows", "$Recycle.Bin", "System Volume Information", "node_modules", ".git",
            "ProgramData", "Recovery", "PerfLogs", "Users", "Program Files",
            "Program Files (x86)", "Intel", "AMD", "NVIDIA", "MSOCache", "Config.Msi",
            "$WinREAgent"
        };

        private static string ScanDrivesForGame()
        {
            Stopwatch watch = Stopwatch.StartNew();
            foreach (DriveInfo drive in DriveInfo.GetDrives())
            {
                if (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable)
                {
                    continue;
                }
                string hit = ScanTree(drive.RootDirectory.FullName, watch);
                if (hit != null)
                {
                    return hit;
                }
                if (watch.ElapsedMilliseconds >= ScanBudgetMs)
                {
                    break;
                }
            }
            return null;
        }

        private static string ScanTree(string root, Stopwatch watch)
        {
            Queue<ScanNode> queue = new Queue<ScanNode>();
            queue.Enqueue(new ScanNode(root, 0));
            while (queue.Count > 0)
            {
                if (watch.ElapsedMilliseconds >= ScanBudgetMs)
                {
                    return null;
                }
                ScanNode node = queue.Dequeue();
                foreach (string exe in GameExeNames)
                {
                    string direct = Path.Combine(node.Dir, exe);
                    if (File.Exists(direct))
                    {
                        return direct;
                    }
                }
                if (node.Depth > ScanMaxDepth)
                {
                    continue;
                }
                string[] subDirs;
                try
                {
                    subDirs = Directory.GetDirectories(node.Dir);
                }
                catch
                {
                    continue;
                }
                foreach (string sub in subDirs)
                {
                    string name = Path.GetFileName(sub);
                    if (ScanSkip.Contains(name))
                    {
                        continue;
                    }
                    if (name.Equals("Genshin Impact Game", StringComparison.OrdinalIgnoreCase))
                    {
                        string hit = ProbeGameDir(sub);
                        if (hit != null)
                        {
                            return hit;
                        }
                    }
                    queue.Enqueue(new ScanNode(sub, node.Depth + 1));
                }
            }
            return null;
        }

        private class ScanNode
        {
            public readonly string Dir;
            public readonly int Depth;

            public ScanNode(string dir, int depth)
            {
                Dir = dir;
                Depth = depth;
            }
        }

        private string FindGenshinInRegistry()
        {
            string[] roots = { @"SOFTWARE\miHoYo", @"SOFTWARE\WOW6432Node\miHoYo", @"Software\miHoYo" };
            RegistryKey[] hives = { Registry.LocalMachine, Registry.CurrentUser };
            foreach (RegistryKey hive in hives)
            {
                foreach (string root in roots)
                {
                    try
                    {
                        using (RegistryKey key = hive.OpenSubKey(root))
                        {
                            if (key == null)
                            {
                                continue;
                            }
                            foreach (string sub in key.GetSubKeyNames())
                            {
                                string hit = ProbeRegistryKey(key, sub);
                                if (hit != null)
                                {
                                    return hit;
                                }
                            }
                        }
                    }
                    catch
                    {
                        // 无权访问或键不存在时继续
                    }
                }
            }
            return null;
        }

        private static string ProbeRegistryKey(RegistryKey parent, string sub)
        {
            try
            {
                using (RegistryKey key = parent.OpenSubKey(sub))
                {
                    if (key == null)
                    {
                        return null;
                    }
                    foreach (string valueName in key.GetValueNames())
                    {
                        string text = Convert.ToString(key.GetValue(valueName)).Trim();
                        if (text.Length == 0)
                        {
                            continue;
                        }
                        string hit = ProbeGameDir(text);
                        if (hit != null)
                        {
                            return hit;
                        }
                    }
                }
            }
            catch
            {
                // 忽略单个键的读取失败
            }
            return null;
        }

        private static IEnumerable<string> CandidateGameDirs()
        {
            List<string> dirs = new List<string>();
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            dirs.Add(Path.Combine(programFiles, "Genshin Impact"));
            dirs.Add(Path.Combine(programFiles, "HoYoPlay", "games", "Genshin Impact"));
            dirs.Add(Path.Combine(programFilesX86, "Genshin Impact"));
            dirs.Add(Path.Combine(localApp, "Programs", "Genshin Impact"));
            dirs.Add(Path.Combine(localApp, "miHoYo", "Genshin Impact"));
            try
            {
                foreach (DriveInfo drive in DriveInfo.GetDrives())
                {
                    if (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable)
                    {
                        continue;
                    }
                    string root = drive.RootDirectory.FullName;
                    dirs.Add(Path.Combine(root, "Genshin Impact"));
                    dirs.Add(Path.Combine(root, "Games", "Genshin Impact"));
                    dirs.Add(Path.Combine(root, "Program Files", "Genshin Impact"));
                    dirs.Add(Path.Combine(root, "原神"));
                }
            }
            catch
            {
                // 枚举磁盘失败时只用固定目录
            }
            return dirs;
        }

        /** 传入目录或 exe 路径，返回可执行的原神游戏程序 */
        private static string ProbeGameDir(string raw)
        {
            string path = raw.Trim().Trim('"');
            if (path.Length < 3)
            {
                return null;
            }
            if (path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                return File.Exists(path) && IsGameExe(Path.GetFileName(path)) ? path : null;
            }
            foreach (string exe in GameExeNames)
            {
                string direct = Path.Combine(path, exe);
                if (File.Exists(direct))
                {
                    return direct;
                }
                string nested = Path.Combine(path, "Genshin Impact Game", exe);
                if (File.Exists(nested))
                {
                    return nested;
                }
            }
            return null;
        }

        private static bool IsGameExe(string name)
        {
            foreach (string exe in GameExeNames)
            {
                if (name.Equals(exe, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private string AskGameExe()
        {
            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "选择原神的游戏程序";
                dialog.Filter = "原神游戏程序 (YuanShen.exe;GenshinImpact.exe)|YuanShen.exe;GenshinImpact.exe|所有程序 (*.exe)|*.exe";
                dialog.CheckFileExists = true;
                dialog.FileName = "YuanShen.exe";
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    return null;
                }
                if (!IsGameExe(Path.GetFileName(dialog.FileName)))
                {
                    MessageBox.Show(this, "请选择 Genshin Impact Game 目录下的 YuanShen.exe 或 GenshinImpact.exe。",
                        "路径不正确", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return null;
                }
                return dialog.FileName;
            }
        }

        private void OpenDataFolder(object sender, EventArgs e)
        {
            Directory.CreateDirectory(dataDir);
            try
            {
                Process.Start("explorer.exe", "\"" + dataDir + "\"");
            }
            catch
            {
                // 忽略资源管理器异常
            }
        }

        private void OpenLog(object sender, EventArgs e)
        {
            try
            {
                if (!File.Exists(logPath))
                {
                    AppendLog("启动器日志已创建。");
                }
                Process.Start("notepad.exe", "\"" + logPath + "\"");
            }
            catch
            {
                // 忽略
            }
        }

        private void KillJava()
        {
            try
            {
                if (javaProcess != null && !javaProcess.HasExited)
                {
                    javaProcess.Kill();
                    javaProcess.WaitForExit(3000);
                }
            }
            catch
            {
                // 进程可能已退出
            }
            javaProcess = null;
            serviceReady = false;
        }

        private static bool PortOpen(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    client.Connect("127.0.0.1", port);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private void AppendLog(string line)
        {
            lock (logLock)
            {
                try
                {
                    File.AppendAllText(logPath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine,
                        Encoding.UTF8);
                }
                catch
                {
                    // 日志失败不影响运行
                }
            }
        }

        private string TailLog(int lines)
        {
            try
            {
                if (!File.Exists(logPath))
                {
                    return "";
                }
                string[] all = File.ReadAllLines(logPath, Encoding.UTF8);
                int start = Math.Max(0, all.Length - lines);
                StringBuilder builder = new StringBuilder();
                for (int i = start; i < all.Length; i += 1)
                {
                    builder.AppendLine(all[i]);
                }
                return builder.ToString().Trim();
            }
            catch
            {
                return "";
            }
        }

        /* ------------------------------ 窗口行为 ------------------------------ */

        private void DragArea_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                ReleaseCapture();
                SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
            }
        }

        private void ToggleMaximize()
        {
            if (WindowState == FormWindowState.Maximized)
            {
                WindowState = FormWindowState.Normal;
            }
            else
            {
                MaximizedBounds = Screen.FromControl(this).WorkingArea;
                WindowState = FormWindowState.Maximized;
            }
        }

        private void LauncherForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            closing = true;
            if (pollTimer != null)
            {
                pollTimer.Stop();
            }
            KillJava();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0084) // WM_NCHITTEST
            {
                base.WndProc(ref m);
                if ((int)m.Result == 1)
                {
                    long value = m.LParam.ToInt64();
                    int x = (int)(value & 0xFFFF);
                    int y = (int)((value >> 16) & 0xFFFF);
                    Point point = PointToClient(new Point(x, y));
                    int edge = 6;
                    bool left = point.X <= edge;
                    bool right = point.X >= ClientSize.Width - edge;
                    bool top = point.Y <= edge;
                    bool bottom = point.Y >= ClientSize.Height - edge;
                    if (top && left) m.Result = (IntPtr)13;
                    else if (top && right) m.Result = (IntPtr)14;
                    else if (bottom && left) m.Result = (IntPtr)16;
                    else if (bottom && right) m.Result = (IntPtr)17;
                    else if (left) m.Result = (IntPtr)10;
                    else if (right) m.Result = (IntPtr)11;
                    else if (top) m.Result = (IntPtr)12;
                    else if (bottom) m.Result = (IntPtr)15;
                }
                return;
            }
            base.WndProc(ref m);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
                return cp;
            }
        }

        [DllImport("user32.dll")]
        private static extern uint GetDpiForSystem();

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern bool PrintWindow(IntPtr handle, IntPtr hdc, uint flags);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr handle, out RECT rect);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr handle);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        private const uint SrcCopy = 0x00CC0020;

        [DllImport("user32.dll")]
        private static extern IntPtr GetDC(IntPtr handle);

        [DllImport("user32.dll")]
        private static extern int ReleaseDC(IntPtr handle, IntPtr hdc);

        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr handle, out RECT rect);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

        [DllImport("gdi32.dll")]
        private static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height,
            IntPtr src, int srcX, int srcY, uint rop);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr obj);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

        private delegate bool EnumWindowsProc(IntPtr handle, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr handle);
    }


}
