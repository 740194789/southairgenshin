package com.southair.genshin.module.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import org.springframework.beans.factory.annotation.Value;

import java.util.ArrayList;
import java.util.List;
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
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 图鉴数据源：按需拉取 Project Amber / Yatta（原神）与 StarRailRes（星穹铁道）的公开 JSON，
 * 返回「名称 → 头像 URL」。结果缓存 12 小时；离线或接口失败时回退旧缓存，不阻塞本地功能。
 *
 * <p>数据来源仅用于非商业个人记录，页面已保留署名说明。</p>
 */
@RestController
@RequestMapping("/api/catalog")
public class CatalogController {

    private static final long CACHE_TTL = 12L * 60 * 60 * 1000;
    private static final int TIMEOUT = 8000;

    private final ObjectMapper objectMapper;
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private final Map<String, RankCacheEntry> rankCache = new ConcurrentHashMap<>();

    @Value("${app.catalog.genshin-url:https://gi.yatta.moe/api/v2/chs/avatar}")
    private String genshinUrl;

    @Value("${app.catalog.starrail-url:https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/characters.json}")
    private String starrailUrl;

    @Value("${app.catalog.genshin-weapon-url:https://gi.yatta.moe/api/v2/chs/weapon}")
    private String genshinWeaponUrl;

    @Value("${app.catalog.starrail-lightcone-url:https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/light_cones.json}")
    private String starrailLightConeUrl;

    public CatalogController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public R<Map<String, String>> avatars(@RequestParam(defaultValue = "genshin") String game) {
        String gameKey = GameType.normalize(game);
        long now = System.currentTimeMillis();
        CacheEntry cached = cache.get(gameKey);
        if (cached != null && now - cached.at < CACHE_TTL) {
            return R.ok(cached.data);
        }
        try {
            Map<String, String> data = GameType.isStarRail(gameKey) ? fetchStarRail() : fetchGenshin();
            cache.put(gameKey, new CacheEntry(data, now));
            return R.ok(data);
        } catch (Exception e) {
            // 网络不可用时返回旧缓存，避免影响离线使用
            if (cached != null) {
                return R.ok(cached.data);
            }
            throw new BusinessException(500, "图鉴数据获取失败（需要联网）：" + e.getMessage());
        }
    }

    /** 武器图标：原神为 Yatta 武器（只取五星），星铁为 StarRailRes 光锥（只取五星） */
    @GetMapping("/weapons")
    public R<Map<String, String>> weapons(@RequestParam(defaultValue = "genshin") String game) {
        String gameKey = GameType.normalize(game);
        String key = gameKey + "-weapon";
        long now = System.currentTimeMillis();
        CacheEntry cached = cache.get(key);
        if (cached != null && now - cached.at < CACHE_TTL) {
            return R.ok(cached.data);
        }
        try {
            Map<String, String> data = GameType.isStarRail(gameKey)
                    ? fetchStarRailLightCones() : fetchGenshinWeapons();
            cache.put(key, new CacheEntry(data, now));
            return R.ok(data);
        } catch (Exception e) {
            if (cached != null) {
                return R.ok(cached.data);
            }
            throw new BusinessException(500, "武器图鉴获取失败（需要联网）：" + e.getMessage());
        }
    }

    /** 星级：名称 → 4/5，用于新角色（如瓦列里）自动归到四星 / 五星 */
    @GetMapping("/ranks")
    public R<Map<String, Integer>> ranks(@RequestParam(defaultValue = "genshin") String game) {
        String gameKey = GameType.normalize(game);
        long now = System.currentTimeMillis();
        RankCacheEntry cached = rankCache.get(gameKey);
        if (cached != null && now - cached.at < CACHE_TTL) {
            return R.ok(cached.data);
        }
        try {
            Map<String, Integer> data = fetchRanks(gameKey);
            rankCache.put(gameKey, new RankCacheEntry(data, now));
            return R.ok(data);
        } catch (Exception e) {
            if (cached != null) {
                return R.ok(cached.data);
            }
            throw new BusinessException(500, "图鉴星级获取失败（需要联网）：" + e.getMessage());
        }
    }

    /** 原神：Yatta 的角色列表，图标拼成 gi.yatta.moe 的静态地址。 */
    private Map<String, String> fetchGenshin() throws Exception {
        JsonNode root = getJson(genshinUrl);
        JsonNode items = root.path("data").path("items");
        Map<String, String> map = new TreeMap<>();
        items.fields().forEachRemaining(entry -> {
            String name = entry.getValue().path("name").asText("").trim();
            String icon = entry.getValue().path("icon").asText("").trim();
            if (!name.isEmpty() && !icon.isEmpty()) {
                map.put(name, "https://gi.yatta.moe/assets/UI/" + icon + (icon.endsWith(".png") ? "" : ".png"));
            }
        });
        return map;
    }

    /** 原神武器：Yatta 武器列表，只保留五星 */
    private Map<String, String> fetchGenshinWeapons() throws Exception {
        JsonNode root = getJson(genshinWeaponUrl);
        JsonNode items = root.path("data").path("items");
        Map<String, String> map = new TreeMap<>();
        items.fields().forEachRemaining(entry -> {
            JsonNode item = entry.getValue();
            if (item.path("rank").asInt(0) != 5) {
                return;
            }
            String name = item.path("name").asText("").trim();
            String icon = item.path("icon").asText("").trim();
            if (!name.isEmpty() && !icon.isEmpty()) {
                map.put(name, "https://gi.yatta.moe/assets/UI/" + icon
                        + (icon.endsWith(".png") ? "" : ".png"));
            }
        });
        return map;
    }

    /** 星铁光锥：StarRailRes 光锥列表，只保留五星 */
    private Map<String, String> fetchStarRailLightCones() throws Exception {
        JsonNode root = getJson(starrailLightConeUrl);
        Map<String, String> map = new TreeMap<>();
        root.fields().forEachRemaining(entry -> {
            JsonNode item = entry.getValue();
            if (item.path("rarity").asInt(0) != 5) {
                return;
            }
            String name = item.path("name").asText("").trim();
            String icon = item.path("icon").asText("").trim();
            if (!name.isEmpty() && !icon.isEmpty()) {
                map.put(name, "https://vizualabstract.github.io/StarRailStaticAPI/assets/" + icon);
            }
        });
        return map;
    }

    /** 名称 → 星级（角色 + 五星武器 / 光锥），用于新角色自动分四星 / 五星 */
    private Map<String, Integer> fetchRanks(String gameKey) throws Exception {
        Map<String, Integer> map = new TreeMap<>();
        if (GameType.isStarRail(gameKey)) {
            JsonNode characters = getJson(starrailUrl);
            characters.fields().forEachRemaining(entry -> {
                String name = entry.getValue().path("name").asText("").trim();
                int rank = entry.getValue().path("rarity").asInt(0);
                if (!name.isEmpty() && rank > 0) {
                    map.put(name, rank);
                }
            });
            JsonNode cones = getJson(starrailLightConeUrl);
            cones.fields().forEachRemaining(entry -> {
                String name = entry.getValue().path("name").asText("").trim();
                int rank = entry.getValue().path("rarity").asInt(0);
                if (!name.isEmpty() && rank > 0) {
                    map.put(name, rank);
                }
            });
            return map;
        }
        JsonNode avatars = getJson(genshinUrl);
        avatars.path("data").path("items").fields().forEachRemaining(entry -> {
            String name = entry.getValue().path("name").asText("").trim();
            int rank = entry.getValue().path("rank").asInt(0);
            if (!name.isEmpty() && rank > 0) {
                map.put(name, rank);
            }
        });
        JsonNode weapons = getJson(genshinWeaponUrl);
        weapons.path("data").path("items").fields().forEachRemaining(entry -> {
            String name = entry.getValue().path("name").asText("").trim();
            int rank = entry.getValue().path("rank").asInt(0);
            if (!name.isEmpty() && rank > 0) {
                map.put(name, rank);
            }
        });
        return map;
    }

    /** 星穹铁道：StarRailRes 的角色 ID + enka 的圆形头像地址。 */
    private Map<String, String> fetchStarRail() throws Exception {
        JsonNode root = getJson(starrailUrl);
        Map<String, String> map = new TreeMap<>();
        root.fields().forEachRemaining(entry -> {
            String name = entry.getValue().path("name").asText("").trim();
            if (!name.isEmpty()) {
                map.put(name, "https://enka.network/ui/hsr/SpriteOutput/AvatarRoundIcon/"
                        + entry.getKey() + ".png");
            }
        });
        return map;
    }

    /**
     * 优先用系统 curl（带整体超时 + 重试）；没有 curl 时再退回 JDK 自带的 HttpURLConnection。
     * 部分站点（如 Cloudflare 防护的 Yatta）会重置 Java 的 TLS 连接或慢速吐数据。
     */
    private JsonNode getJson(String url) throws Exception {
        // 先走系统 curl：带整体超时与重试，Yatta 这类站点对 Java TLS 指纹不友好时更稳
        String body = getJsonByCurl(url);
        if (body != null && !body.trim().isEmpty()) {
            return objectMapper.readTree(body);
        }
        return getJsonByJava(url);
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
        List<String> commands = new ArrayList<>();
        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            // PATH 里的 curl 往往是较新的版本；系统自带的旧 curl 访问部分站点会 TLS 握手失败
            commands.add("curl.exe");
            String systemRoot = System.getenv("SystemRoot");
            commands.add((systemRoot == null ? "C:\\Windows" : systemRoot) + "\\System32\\curl.exe");
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
                command, "-sL", "--max-time", "8", "--compressed",
                "--retry", "1", "--retry-all-errors", "--retry-delay", "1",
                "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "-H", "Accept: application/json", url);
        builder.redirectErrorStream(true);
        try {
            Process process = builder.start();
            if (!process.waitFor(20, TimeUnit.SECONDS)) {
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

    private static class CacheEntry {
        final Map<String, String> data;
        final long at;

        CacheEntry(Map<String, String> data, long at) {
            this.data = data;
            this.at = at;
        }
    }

    private static class RankCacheEntry {
        final Map<String, Integer> data;
        final long at;

        RankCacheEntry(Map<String, Integer> data, long at) {
            this.data = data;
            this.at = at;
        }
    }
}
