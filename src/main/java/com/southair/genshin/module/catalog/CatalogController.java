package com.southair.genshin.module.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import org.springframework.beans.factory.annotation.Value;
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

    @Value("${app.catalog.genshin-url:https://gi.yatta.moe/api/v2/chs/avatar}")
    private String genshinUrl;

    @Value("${app.catalog.starrail-url:https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/cn/characters.json}")
    private String starrailUrl;

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

    private JsonNode getJson(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(TIMEOUT);
        connection.setReadTimeout(TIMEOUT);
        connection.setRequestProperty("User-Agent", "SouthAirGenshin/1.0");
        try {
            if (connection.getResponseCode() != 200) {
                throw new BusinessException(500, "HTTP " + connection.getResponseCode());
            }
            try (InputStream in = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                return objectMapper.readTree(sb.toString());
            }
        } finally {
            connection.disconnect();
        }
    }

    private static class CacheEntry {
        final Map<String, String> data;
        final long at;

        CacheEntry(Map<String, String> data, long at) {
            this.data = data;
            this.at = at;
        }
    }
}
