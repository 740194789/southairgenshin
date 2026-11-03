package com.southair.genshin.module.calendar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 卡池日历：内置数据 + 官方公告实时同步。
 *
 * <p>内置数据完全离线，读取 classpath 下的 calendar/banners.json；
 * 实时数据从米游社官方公告接口抓取「活动祈愿」条目，按结束时间归并为上下期。</p>
 */
@RestController
@RequestMapping("/api/calendar")
public class CalendarController {

    private static final String GENSHIN_ANN_URL = "https://hk4e-api.mihoyo.com/common/hk4e_cn/"
            + "announcement/api/getAnnList?game=hk4e&game_biz=hk4e_cn&lang=zh-cn"
            + "&bundle_id=hk4e_cn&platform=pc&region=cn_gf01&level=60&uid=100000000";
    private static final int TIMEOUT = 8000;
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final Pattern VERSION_PATTERN = Pattern.compile("(\\d+\\.\\d+)版本");

    private final ObjectMapper objectMapper;
    private volatile JsonNode cache;

    public CalendarController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public R<JsonNode> calendar(@RequestParam(defaultValue = "genshin") String game) {
        JsonNode root = load();
        JsonNode node = root.path(GameType.normalize(game));
        if (node.isMissingNode() || node.isNull()) {
            return R.ok(objectMapper.createObjectNode());
        }
        return R.ok(node);
    }

    /**
     * 官方公告实时同步（仅原神）：返回与内置日历相同的结构，前端按 12 小时缓存。
     */
    @GetMapping("/live")
    public R<JsonNode> live(@RequestParam(defaultValue = "genshin") String game) {
        if (GameType.isStarRail(GameType.normalize(game))) {
            throw new BusinessException(400, "星穹铁道暂未提供公开卡池接口，卡池日历仅支持原神");
        }
        JsonNode root = getJson(GENSHIN_ANN_URL);
        ObjectNode result = buildLive(root);
        return R.ok(result);
    }

    private ObjectNode buildLive(JsonNode root) {
        List<WishPhase> phases = new ArrayList<>();
        String version = "";
        String updatedAt = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        JsonNode groups = root.path("data").path("list");
        for (JsonNode group : groups) {
            for (JsonNode ann : group.path("list")) {
                String title = ann.path("title").asText("").trim();
                Matcher matcher = VERSION_PATTERN.matcher(title);
                while (matcher.find()) {
                    if (compareVersion(matcher.group(1), version) > 0) {
                        version = matcher.group(1);
                    }
                }
                if (!title.contains("祈愿")
                        || (!title.contains("概率UP") && !title.contains("集录祈愿"))) {
                    continue;
                }
                LocalDateTime start = parseTime(ann.path("start_time").asText(""));
                LocalDateTime end = parseTime(ann.path("end_time").asText(""));
                if (end == null) {
                    continue;
                }
                WishPhase phase = findOrCreate(phases, end);
                if (start != null && (phase.start == null || start.isBefore(phase.start))) {
                    phase.start = start;
                }
                phase.end = end;
                parseBanners(title, phase.banners);
            }
        }
        // 只保留尚未结束或刚结束不久的分期，最多 3 期
        LocalDateTime cutoff = LocalDateTime.now().minusHours(12);
        phases.removeIf(phase -> phase.end.isBefore(cutoff));
        phases.sort(Comparator.comparing(phase -> phase.end));
        if (phases.size() > 3) {
            phases = new ArrayList<>(phases.subList(0, 3));
        }
        for (int i = 0; i < phases.size(); i++) {
            WishPhase phase = phases.get(i);
            if (i > 0 && phases.get(i - 1).end != null) {
                phase.start = phases.get(i - 1).end;
            }
            if (phase.start == null) {
                phase.start = phase.end.minusDays(21);
            }
        }

        ObjectNode calendar = objectMapper.createObjectNode();
        calendar.put("currency", "原石");
        calendar.put("updatedAt", updatedAt);
        calendar.put("note", "来自米游社官方公告实时同步；预估收入未提供，剩余天数按公告结束时间计算");
        ArrayNode versions = calendar.putArray("versions");
        ObjectNode versionNode = versions.addObject();
        versionNode.put("version", version.isEmpty() ? "实时" : version);
        versionNode.put("start", phases.isEmpty() ? "" : phases.get(0).start.toLocalDate().toString());
        versionNode.put("end", phases.isEmpty() ? "" : phases.get(phases.size() - 1).end.toLocalDate().toString());
        ArrayNode phaseArray = versionNode.putArray("phases");
        for (int i = 0; i < phases.size(); i++) {
            WishPhase phase = phases.get(i);
            ObjectNode node = phaseArray.addObject();
            node.put("name", "第" + (i + 1) + "期");
            node.put("start", phase.start.toLocalDate().toString());
            node.put("end", phase.end.toLocalDate().toString());
            node.put("incomePrimogems", 0);
            ArrayNode banners = node.putArray("banners");
            phase.banners.forEach(banner -> {
                ObjectNode item = banners.addObject();
                item.put("pool", banner.pool);
                item.put("name", banner.name);
            });
        }
        return calendar;
    }

    private WishPhase findOrCreate(List<WishPhase> phases, LocalDateTime end) {
        for (WishPhase phase : phases) {
            if (phase.end != null && phase.end.equals(end)) {
                return phase;
            }
        }
        WishPhase phase = new WishPhase();
        phase.end = end;
        phases.add(phase);
        return phase;
    }

    private void parseBanners(String title, List<Banner> banners) {
        String pool = title.contains("神铸赋形") ? "武器活动"
                : (title.contains("集录祈愿") ? "集录祈愿" : "角色活动");
        int colon = Math.max(title.indexOf('：'), title.indexOf(':'));
        String segment = colon >= 0 ? title.substring(colon + 1) : title;
        int up = segment.indexOf("概率UP");
        if (up >= 0) {
            segment = segment.substring(0, up);
        }
        for (String raw : segment.split("」「|、")) {
            String name = raw.replace("「", "").replace("」", "").trim();
            if (name.isEmpty()) {
                continue;
            }
            boolean exists = banners.stream().anyMatch(item -> item.name.equals(name));
            if (!exists) {
                banners.add(new Banner(pool, name));
            }
        }
    }

    private int compareVersion(String left, String right) {
        if (right == null || right.isEmpty()) {
            return 1;
        }
        try {
            String[] a = left.split("\\.");
            String[] b = right.split("\\.");
            int major = Integer.parseInt(a[0]) - Integer.parseInt(b[0]);
            if (major != 0) {
                return major;
            }
            int minorA = a.length > 1 ? Integer.parseInt(a[1]) : 0;
            int minorB = b.length > 1 ? Integer.parseInt(b[1]) : 0;
            return minorA - minorB;
        } catch (Exception e) {
            return 0;
        }
    }

    private LocalDateTime parseTime(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        try {
            return LocalDateTime.parse(value.trim(), TIME_FORMAT);
        } catch (Exception e) {
            return null;
        }
    }

    private JsonNode getJson(String url) {
        try {
            return getJsonByJava(url);
        } catch (Exception javaError) {
            String body = getJsonByCurl(url);
            if (body == null || body.trim().isEmpty()) {
                throw new BusinessException(500, "实时卡池获取失败（需要联网）：" + javaError.getMessage());
            }
            try {
                return objectMapper.readTree(body);
            } catch (Exception e) {
                throw new BusinessException(500, "实时卡池解析失败：" + e.getMessage());
            }
        }
    }

    private JsonNode getJsonByJava(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(TIMEOUT);
        connection.setReadTimeout(TIMEOUT);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() != 200) {
                throw new BusinessException(500, "HTTP " + connection.getResponseCode());
            }
            try (InputStream in = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                return objectMapper.readTree(readAll(reader));
            }
        } finally {
            connection.disconnect();
        }
    }

    private String getJsonByCurl(String url) {
        TreeSet<String> commands = new TreeSet<>();
        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            String systemRoot = System.getenv("SystemRoot");
            commands.add((systemRoot == null ? "C:\\Windows" : systemRoot) + "\\System32\\curl.exe");
            commands.add("curl.exe");
        }
        commands.add("curl");
        for (String command : commands) {
            String body = runCurl(command, url);
            if (body != null && !body.trim().isEmpty()) {
                return body;
            }
        }
        return null;
    }

    private String runCurl(String command, String url) {
        ProcessBuilder builder = new ProcessBuilder(
                command, "-sL", "--max-time", "20", "--compressed",
                "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "-H", "Accept: application/json", url);
        builder.redirectErrorStream(true);
        try {
            Process process = builder.start();
            if (!process.waitFor(25, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return null;
            }
            if (process.exitValue() != 0) {
                return null;
            }
            try (InputStream in = process.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                return readAll(reader);
            }
        } catch (Exception e) {
            return null;
        }
    }

    private String readAll(BufferedReader reader) throws Exception {
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        return sb.toString();
    }

    private JsonNode load() {
        JsonNode local = cache;
        if (local != null) {
            return local;
        }
        synchronized (this) {
            if (cache != null) {
                return cache;
            }
            ClassPathResource resource = new ClassPathResource("calendar/banners.json");
            try (InputStream in = resource.getInputStream()) {
                cache = objectMapper.readTree(in);
            } catch (Exception e) {
                throw new BusinessException(500, "卡池日历读取失败：" + e.getMessage());
            }
            return cache;
        }
    }

    private static class WishPhase {
        LocalDateTime start;
        LocalDateTime end;
        final List<Banner> banners = new ArrayList<>();
    }

    private static class Banner {
        final String pool;
        final String name;

        Banner(String pool, String name) {
            this.pool = pool;
            this.name = name;
        }
    }
}
