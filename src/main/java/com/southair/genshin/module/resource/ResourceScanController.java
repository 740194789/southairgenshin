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
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 电脑端资源识图小工具的启动入口。
 *
 * <p>识图逻辑仍由 tools/resource_scan 的独立脚本完成；这里只负责找到脚本、
 * 判断是否已校准，并在首次使用时优先打开校准。</p>
 */
@RestController
@RequestMapping("/api/resource-scan")
public class ResourceScanController {

    private static final String SCRIPT_DIR = "tools" + File.separator + "resource_scan";

    private final ObjectMapper objectMapper;

    @Value("${app.resource-scan.dir:}")
    private String configuredDir;

    public ResourceScanController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping("/status")
    public R<Map<String, Object>> status() {
        File dir = resolveScriptDir();
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("available", dir != null);
        data.put("scriptDir", dir == null ? "" : dir.getAbsolutePath());
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
        if (dir == null) {
            throw new BusinessException("未找到 tools/resource_scan，请确认识图脚本与程序在同一目录");
        }
        File batch = new File(dir, "run.bat");
        if (!batch.isFile()) {
            throw new BusinessException("缺少 run.bat，无法启动识图工具");
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
        data.put("calibrated", state.calibrated);
        data.put("scriptDir", dir.getAbsolutePath());
        return R.ok(data);
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
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
