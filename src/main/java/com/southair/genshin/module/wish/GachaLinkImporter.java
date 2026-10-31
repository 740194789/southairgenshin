package com.southair.genshin.module.wish;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.module.wish.dto.WishImportResult;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 通过米游社「抽卡记录」链接导入。
 *
 * <p>浏览器直连该接口会被跨域拦截，因此由后端代理抓取；链接中的 authkey
 * 属于账号凭证，只在本次请求内使用，不落库、不写日志。</p>
 *
 * <p>接口不返回「第几抽」，保底抽数由本服务按卡池内出货顺序自行推算；
 * 五星是否 UP 也无法从接口判断，统一先记为未中 UP，用户可在记录里修正。</p>
 */
@Service
public class GachaLinkImporter {

    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            "public-operation-hk4e.mihoyo.com",
            "public-operation-hkrpg.mihoyo.com",
            "public-operation-hk4e-sg.hoyoverse.com",
            "public-operation-hkrpg-sg.hoyoverse.com"
    ));

    /** 抽卡记录网页（分享链接）的域名，需要转换成真正的 API 地址。 */
    private static final Set<String> WEB_HOSTS = new HashSet<>(Arrays.asList(
            "webstatic.mihoyo.com",
            "webstatic.hoyoverse.com",
            "webstatic-sea.mihoyo.com",
            "webstatic-sea.hoyoverse.com"
    ));

    /** 网页链接里真正会被接口使用的参数，其余（gacha_id、timestamp、frmId 等）一并丢弃。 */
    private static final Set<String> API_PARAMS = new HashSet<>(Arrays.asList(
            "authkey", "authkey_ver", "sign_type", "auth_appid", "lang", "region", "game_biz"
    ));

    /**
     * 原神角色活动池：常驻角色 8 位（5.5 加入梦见月瑞希）算歪，其余算当期 UP。
     * 原神常驻武器 10 把、崩铁常驻光锥 7 张用于武器池判定。
     */
    private static final Set<String> GENSHIN_STANDARD_CHARACTERS = new HashSet<>(Arrays.asList(
            "迪卢克", "琴", "莫娜", "七七", "刻晴", "提纳里", "迪希雅", "梦见月瑞希"
    ));

    private static final Set<String> GENSHIN_STANDARD_WEAPONS = new HashSet<>(Arrays.asList(
            "天空之刃", "天空之翼", "天空之傲", "天空之卷", "天空之脊",
            "阿莫斯之弓", "狼的末路", "风鹰剑", "四风原典", "和璞鸢"
    ));

    private static final Set<String> STARRAIL_STANDARD_LIGHT_CONES = new HashSet<>(Arrays.asList(
            "银河铁道之夜", "无可取代的东西", "但战斗还未结束", "以世界之名",
            "制胜的瞬间", "于夜色中", "时节不居"
    ));

    /**
     * 崩铁 [星缘相邀] 可选角色（官方公告 4.6，共 13 位）。
     *
     * <p>角色活动跃迁出五星时：50% 为当期 UP，50% 从「本期 UP + 7 名星缘相邀角色」
     * 中产出。接口只返回物品名，无法区分，因此按官方可选列表判定：
     * 命中星缘相邀名单或常驻名单即算歪，其余五星算当期 UP。</p>
     */
    private static final Set<String> STARRAIL_STANDARD_CHARACTERS = new HashSet<>(Arrays.asList(
            "姬子", "瓦尔特", "布洛妮娅", "杰帕德", "克拉拉", "彦卿", "白露"
    ));

    private static final Set<String> STARRAIL_XINGYUAN_CHARACTERS = new HashSet<>(Arrays.asList(
            "云璃", "银枝", "银狼", "符玄", "刃", "希儿"
    ));

    private static final String[][] GENSHIN_TYPES = {
            {"301", "角色活动"}, {"302", "武器活动"}, {"200", "常驻"}, {"400", "集录祈愿"}
    };

    private static final String[][] STARRAIL_TYPES = {
            {"11", "角色活动"}, {"12", "光锥活动"}, {"21", "联动"}, {"22", "联动"}, {"1", "常驻"}
    };

    private static final int PAGE_SIZE = 20;
    private static final int MAX_PAGES_PER_TYPE = 200;
    private static final int MAX_RECORDS = 20000;
    private static final int TIMEOUT_MS = 10000;
    private static final long REQUEST_INTERVAL_MS = 300L;
    private static final long RETRY_INTERVAL_MS = 1200L;
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final WishService wishService;
    private final ObjectMapper objectMapper;

    public GachaLinkImporter(WishService wishService, ObjectMapper objectMapper) {
        this.wishService = wishService;
        this.objectMapper = objectMapper;
    }

    /**
     * 读取链接中的全部抽卡记录并导入当前账号。
     */
    public WishImportResult importFrom(String rawUrl, Long userId, String game, String mode) {
        if (!StringUtils.hasText(rawUrl)) {
            throw new BusinessException("请粘贴抽卡记录链接");
        }
        String url = rawUrl.trim();
        URI uri = parseUri(url);
        String host = uri == null ? null : uri.getHost();
        boolean webLink = host != null && WEB_HOSTS.contains(host);
        boolean apiLink = host != null && ALLOWED_HOSTS.contains(host);
        if (!webLink && !apiLink) {
            throw new BusinessException("链接不是米游社抽卡记录地址，请重新复制");
        }

        String gameKey = GameType.normalize(game);
        boolean starrailLink = webLink
                ? uri.getPath() != null && uri.getPath().toLowerCase().contains("hkrpg")
                : host.contains("hkrpg");
        if (starrailLink != GameType.isStarRail(gameKey)) {
            throw new BusinessException(starrailLink
                    ? "这是崩坏：星穹铁道的链接，请切换游戏后重试"
                    : "这是原神的链接，请切换游戏后重试");
        }

        String base = webLink ? buildApiBase(url, starrailLink) : buildBase(url);
        if (!base.contains("authkey=")) {
            throw new BusinessException("链接中缺少 authkey，请重新复制");
        }
        String[][] types = starrailLink ? STARRAIL_TYPES : GENSHIN_TYPES;

        List<GachaItem> items = new ArrayList<>();
        for (String[] type : types) {
            fetchType(base, type[0], type[1], items);
        }
        if (items.isEmpty()) {
            throw new BusinessException("链接中没有读到抽卡记录，authkey 可能已失效，请重新复制");
        }

        applyPity(items);

        List<WishRecord> records = new ArrayList<>(items.size());
        long now = System.currentTimeMillis();
        for (GachaItem item : items) {
            WishRecord record = new WishRecord();
            record.setItemName(item.name);
            record.setItemType(item.itemType);
            record.setPool(item.pool);
            record.setRarity(item.rarity);
            record.setIsUp(resolveIsUp(item, starrailLink));
            record.setPityCount(item.pity);
            record.setWishTime(item.time);
            record.setClientUid("gacha-" + item.id);
            record.setEditedAt(now);
            records.add(record);
        }
        return wishService.importRecords(userId, gameKey, records, mode, MAX_RECORDS);
    }

    /**
     * 活动池的五星 UP 判定。
     *
     * <p>原神角色活动：不在常驻角色名单即当期 UP；武器活动同理按常驻武器判定。</p>
     * <p>崩铁光锥活动：不在常驻光锥名单即当期 UP。</p>
     * <p>崩铁角色活动：命中常驻或星缘相邀名单算歪，其余算当期 UP。</p>
     */
    private boolean resolveIsUp(GachaItem item, boolean starrail) {
        if (item.rarity < 5) {
            return false;
        }
        if ("角色活动".equals(item.pool)) {
            if (starrail) {
                return !STARRAIL_STANDARD_CHARACTERS.contains(item.name)
                        && !STARRAIL_XINGYUAN_CHARACTERS.contains(item.name);
            }
            return !GENSHIN_STANDARD_CHARACTERS.contains(item.name);
        }
        if ("武器活动".equals(item.pool)) {
            return !GENSHIN_STANDARD_WEAPONS.contains(item.name);
        }
        if ("光锥活动".equals(item.pool)) {
            return !STARRAIL_STANDARD_LIGHT_CONES.contains(item.name);
        }
        return false;
    }

    private URI parseUri(String url) {
        try {
            return URI.create(url);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * 抽卡记录网页（webstatic）链接转成真正的接口地址：
     * 原神走 gacha_info/api/getGachaLog，星铁走 common/gacha_record/api/getGachaLog。
     */
    private String buildApiBase(String url, boolean starrail) {
        String endpoint = starrail
                ? "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog"
                : "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog";

        int queryIndex = url.indexOf('?');
        String rawQuery = queryIndex < 0 ? "" : url.substring(queryIndex + 1);
        StringBuilder kept = new StringBuilder();
        boolean hasGameBiz = false;
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            if (!API_PARAMS.contains(key)) {
                continue;
            }
            if ("game_biz".equals(key)) {
                hasGameBiz = true;
            }
            if (kept.length() > 0) {
                kept.append('&');
            }
            kept.append(pair);
        }
        if (!hasGameBiz) {
            kept.append("&game_biz=").append(starrail ? "hkrpg_cn" : "hk4e_cn");
        }
        return endpoint + "?" + kept;
    }

    /**
     * 保留原链接中除分页参数外的全部参数（尤其是 authkey），
     * 避免解码重编码造成签名失效。
     */
    private String buildBase(String url) {
        int queryIndex = url.indexOf('?');
        String base = queryIndex < 0 ? url : url.substring(0, queryIndex);
        String rawQuery = queryIndex < 0 ? "" : url.substring(queryIndex + 1);

        StringBuilder kept = new StringBuilder();
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            String key = pair.indexOf('=') < 0 ? pair : pair.substring(0, pair.indexOf('='));
            if ("gacha_type".equals(key) || "page".equals(key) || "size".equals(key) || "end_id".equals(key)) {
                continue;
            }
            if (kept.length() > 0) {
                kept.append('&');
            }
            kept.append(pair);
        }
        return base + "?" + kept;
    }

    private void fetchType(String base, String gachaType, String pool, List<GachaItem> out) {
        String endId = "0";
        for (int page = 1; page <= MAX_PAGES_PER_TYPE; page++) {
            // 米游社接口对连续请求较敏感，逐页之间稍作间隔
            throttle(page > 1);
            String requestUrl = base + "&gacha_type=" + gachaType + "&page=" + page
                    + "&size=" + PAGE_SIZE + "&end_id=" + endId;
            JsonNode root = requestWithRetry(requestUrl);
            JsonNode list = root.path("data").path("list");
            if (!list.isArray() || list.size() == 0) {
                return;
            }
            String lastId = endId;
            for (JsonNode node : list) {
                GachaItem item = new GachaItem();
                item.id = node.path("id").asText("");
                item.name = node.path("name").asText("");
                item.itemType = node.path("item_type").asText("");
                item.rarity = node.path("rank_type").asInt(3);
                item.time = parseTime(node.path("time").asText(""));
                item.pool = pool;
                out.add(item);
                if (StringUtils.hasText(item.id)) {
                    lastId = item.id;
                }
            }
            if (list.size() < PAGE_SIZE || lastId.equals(endId)) {
                return;
            }
            endId = lastId;
        }
    }

    private void throttle(boolean wait) {
        if (!wait) {
            return;
        }
        try {
            Thread.sleep(REQUEST_INTERVAL_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 米游社在高频请求下可能返回 -110，稍等后重试一次再判定 authkey 失效。
     */
    private JsonNode requestWithRetry(String url) {
        JsonNode root = readJson(url);
        int retcode = root.path("retcode").asInt(-1);
        if (retcode == 0) {
            return root;
        }
        if (retcode == -110 || retcode == -101 || retcode == -100 || retcode == -109) {
            try {
                Thread.sleep(RETRY_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            root = readJson(url);
            retcode = root.path("retcode").asInt(-1);
            if (retcode == 0) {
                return root;
            }
        }
        throw new BusinessException(retcodeMessage(retcode));
    }

    /**
     * 按卡池分别累加出货序号，命中五星时记录本次保底抽数并清零，
     * 与游戏内「已累计 X 抽」的口径一致。
     */
    private void applyPity(List<GachaItem> items) {
        Map<String, List<GachaItem>> byPool = new HashMap<>();
        for (GachaItem item : items) {
            byPool.computeIfAbsent(item.pool, key -> new ArrayList<>()).add(item);
        }
        for (List<GachaItem> poolItems : byPool.values()) {
            poolItems.sort(Comparator
                    .comparing((GachaItem item) -> item.time)
                    .thenComparingLong(item -> parseId(item.id)));
            int count = 0;
            for (GachaItem item : poolItems) {
                count++;
                item.pity = count;
                if (item.rarity >= 5) {
                    count = 0;
                }
            }
        }
    }

    private LocalDateTime parseTime(String value) {
        try {
            return LocalDateTime.parse(value, TIME_FORMAT);
        } catch (Exception e) {
            return LocalDateTime.now();
        }
    }

    private long parseId(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    private JsonNode readJson(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
            int code = connection.getResponseCode();
            if (code != 200) {
                throw new BusinessException("读取抽卡记录失败（HTTP " + code + "），请稍后重试");
            }
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int read;
                while ((read = in.read(chunk)) > 0) {
                    buffer.write(chunk, 0, read);
                }
                return objectMapper.readTree(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            throw new BusinessException("无法连接米游社接口，请检查网络后重试");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String retcodeMessage(int retcode) {
        switch (retcode) {
            case -101:
            case -100:
            case -109:
                return "authkey 已失效，请在游戏内重新打开抽卡记录并复制新链接";
            case -110:
                return "authkey 校验失败，请重新复制链接";
            case -111:
                return "登录凭证无效，请重新复制链接";
            case -500001:
                return "米游社接口繁忙，请稍后重试";
            default:
                return "读取抽卡记录失败（错误码 " + retcode + "）";
        }
    }

    /** 接口返回的单条抽卡记录，附加推算后的保底抽数。 */
    private static class GachaItem {
        String id;
        String name;
        String itemType;
        String pool;
        LocalDateTime time;
        int rarity;
        int pity;
    }
}
