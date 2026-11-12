package com.southair.genshin.module.resource;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.R;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 电脑端资源识图小工具的启动入口。
 *
 * <p>识图逻辑仍由 tools/resource_scan 的独立脚本完成；这里只负责找到脚本、
 * 判断是否已校准，并在首次使用时优先打开校准。</p>
 *
 * <p>程序目录里没有识图环境时（例如别人只更新了 jar），会从最新 Release
 * 下载 resource-scan.zip 并解压，用户无需手动处理。</p>
 */
@RestController
@RequestMapping("/api/resource-scan")
public class ResourceScanController {

    private static final String SCRIPT_DIR = "tools" + File.separator + "resource_scan";
    private static final String DEFAULT_DOWNLOAD_URL =
            "https://github.com/740194789/southairgenshin/releases/latest/download/resource-scan.zip";
    private static final Object DOWNLOAD_LOCK = new Object();

    private static volatile boolean downloading = false;
    private static volatile String downloadError = "";

    private final ObjectMapper objectMapper;

    @Value("${app.resource-scan.dir:}")
    private String configuredDir;

    @Value("${app.resource-scan.download-url:" + DEFAULT_DOWNLOAD_URL + "}")
    private String downloadUrl;

    public ResourceScanController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping("/status")
    public R<Map<String, Object>> status() {
        File dir = resolveScriptDir();
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("available", dir != null);
        data.put("scriptDir", dir == null ? "" : dir.getAbsolutePath());
        data.put("ready", dir != null && isRuntimeReady(dir));
        data.put("downloading", downloading);
        data.put("downloadError", downloadError);
        data.put("calibrated", false);
        data.put("calibratedPages", 0);
        if (dir != null) {
            CalibrationState state = readState(dir);
            data.put("calibrated", state.calibrated);
            data.put("calibratedPages", state.pages);
        }
        return R.ok(data);
    }

    @PostMapping("/launch")
    public R<Map<String, Object>> launch(@RequestParam(defaultValue = "auto") String mode) {
        if (!isWindows()) {
            throw new BusinessException("识图工具目前仅支持 Windows");
        }
        File dir = resolveScriptDir();
        if (dir == null || !isRuntimeReady(dir)) {
            File target = dir != null ? dir : installDir();
            startRuntimeDownload(target);
            Map<String, Object> data = new LinkedHashMap<String, Object>();
            data.put("mode", "downloading");
            data.put("downloading", true);
            data.put("downloadError", downloadError);
            data.put("scriptDir", target.getAbsolutePath());
            return R.ok(data);
        }

        CalibrationState state = readState(dir);
        String action;
        if ("calibrate".equalsIgnoreCase(mode)) {
            action = "calibrate";
        } else if ("scan".equalsIgnoreCase(mode) && state.calibrated) {
            action = "scan";
        } else {
            // auto：首次使用（还没有任何已校准区域）优先进入校准
            action = state.calibrated ? "scan" : "calibrate";
        }

        File batch = new File(dir, "run.bat");
        List<String> command = new ArrayList<String>();
        command.add("cmd.exe");
        command.add("/c");
        command.add("start");
        command.add("资源识图");
        command.add("/D");
        command.add(dir.getAbsolutePath());
        command.add(batch.getAbsolutePath());
        if ("calibrate".equals(action)) {
            command.add("--calibrate");
        }
        try {
            new ProcessBuilder(command).directory(dir).start();
        } catch (IOException ex) {
            throw new BusinessException("启动识图工具失败：" + ex.getMessage());
        }

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("mode", action);
        data.put("downloading", false);
        data.put("calibrated", state.calibrated);
        data.put("scriptDir", dir.getAbsolutePath());
        return R.ok(data);
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    /** 运行时就绪：run.bat 与内置 Python 都存在。 */
    private boolean isRuntimeReady(File dir) {
        return new File(dir, "run.bat").isFile()
                && new File(dir, "python" + File.separator + "python.exe").isFile();
    }

    /** 依次尝试配置目录、工作目录、classpath / jar 所在目录的上级，定位识图脚本。 */
    private File resolveScriptDir() {
        if (configuredDir != null && !configuredDir.trim().isEmpty()) {
            File configured = new File(configuredDir.trim());
            if (configured.isDirectory()) {
                return configured;
            }
        }
        File fromWorkDir = new File(System.getProperty("user.dir", "."), SCRIPT_DIR);
        if (fromWorkDir.isDirectory()) {
            return fromWorkDir;
        }
        try {
            File location = new File(getClass().getProtectionDomain().getCodeSource()
                    .getLocation().toURI());
            File cursor = location.isDirectory() ? location : location.getParentFile();
            for (int depth = 0; depth < 6 && cursor != null; depth++) {
                File candidate = new File(cursor, SCRIPT_DIR);
                if (candidate.isDirectory()) {
                    return candidate;
                }
                cursor = cursor.getParentFile();
            }
        } catch (Exception ignored) {
            // 无法从代码位置定位时返回 null，由调用方提示
        }
        return null;
    }

    /** 找不到现成脚本时，安装到 jar 所在目录（绿色版根目录）下的 tools/resource_scan。 */
    private File installDir() {
        try {
            File location = new File(getClass().getProtectionDomain().getCodeSource()
                    .getLocation().toURI());
            File base = location.isDirectory() ? location : location.getParentFile();
            if (base != null) {
                return new File(base, SCRIPT_DIR);
            }
        } catch (Exception ignored) {
            // 退回工作目录
        }
        return new File(new File(System.getProperty("user.dir", ".")), SCRIPT_DIR);
    }

    /** 后台下载并解压识图环境；重复点击不会重复下载。 */
    private void startRuntimeDownload(final File scriptDir) {
        synchronized (DOWNLOAD_LOCK) {
            if (downloading) {
                return;
            }
            downloading = true;
            downloadError = "";
        }
        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                File temp = null;
                try {
                    File toolsDir = scriptDir.getParentFile();
                    if (toolsDir == null) {
                        throw new IOException("无法确定识图工具的安装目录");
                    }
                    if (!toolsDir.isDirectory() && !toolsDir.mkdirs()) {
                        throw new IOException("无法创建目录：" + toolsDir.getAbsolutePath());
                    }
                    temp = File.createTempFile("resource-scan", ".zip");
                    download(downloadUrl, temp);
                    unzip(temp, toolsDir);
                } catch (Exception ex) {
                    String message = ex.getMessage();
                    downloadError = message == null || message.trim().isEmpty() ? "下载识图环境失败" : message;
                } finally {
                    if (temp != null && temp.exists() && !temp.delete()) {
                        temp.deleteOnExit();
                    }
                    downloading = false;
                }
            }
        }, "resource-scan-download");
        worker.setDaemon(true);
        worker.start();
    }

    private void download(String url, File target) throws IOException {
        String current = url;
        for (int redirects = 0; redirects <= 5; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(600000);
            connection.setRequestProperty("User-Agent", "SouthAirGenshin");
            try {
                int code = connection.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        throw new IOException("下载地址跳转异常");
                    }
                    current = location;
                    continue;
                }
                if (code != 200) {
                    throw new IOException("下载识图环境失败（HTTP " + code + "）");
                }
                InputStream input = connection.getInputStream();
                try {
                    Files.copy(input, target.toPath(), StandardCopyOption.REPLACE_EXISTING);
                } finally {
                    input.close();
                }
                return;
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("下载地址跳转次数过多");
    }

    private void unzip(File zip, File destDir) throws IOException {
        File dest = destDir.getCanonicalFile();
        String prefix = dest.getPath() + File.separator;
        ZipInputStream input = new ZipInputStream(new FileInputStream(zip));
        try {
            byte[] buffer = new byte[8192];
            ZipEntry entry;
            while ((entry = input.getNextEntry()) != null) {
                File out = new File(dest, entry.getName());
                if (!out.getCanonicalPath().startsWith(prefix)) {
                    throw new IOException("压缩包内路径异常：" + entry.getName());
                }
                if (entry.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) {
                        throw new IOException("无法创建目录：" + out.getAbsolutePath());
                    }
                } else {
                    File parent = out.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("无法创建目录：" + parent.getAbsolutePath());
                    }
                    OutputStream output = new FileOutputStream(out);
                    try {
                        int length;
                        while ((length = input.read(buffer)) > 0) {
                            output.write(buffer, 0, length);
                        }
                    } finally {
                        output.close();
                    }
                }
                input.closeEntry();
            }
        } finally {
            input.close();
        }
    }

    /** 读取 config.json：至少有一个页面校准过区域才算已校准。 */
    private CalibrationState readState(File dir) {
        File config = new File(dir, "config.json");
        if (!config.isFile()) {
            return new CalibrationState(false, 0);
        }
        try {
            JsonNode root = objectMapper.readTree(config);
            int calibrated = 0;
            JsonNode pages = root.path("pages");
            if (pages.isArray()) {
                for (JsonNode page : pages) {
                    JsonNode regions = page.path("regions");
                    if (regions.isObject() && regions.size() > 0) {
                        calibrated++;
                    }
                }
            }
            if (calibrated == 0) {
                // 兼容旧版单页面配置
                JsonNode legacy = root.path("regions");
                if (legacy.isObject() && legacy.size() > 0) {
                    calibrated = 1;
                }
            }
            return new CalibrationState(calibrated > 0, calibrated);
        } catch (IOException ex) {
            return new CalibrationState(false, 0);
        }
    }

    private static final class CalibrationState {
        private final boolean calibrated;
        private final int pages;

        private CalibrationState(boolean calibrated, int pages) {
            this.calibrated = calibrated;
            this.pages = pages;
        }
    }
}
