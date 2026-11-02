package com.southair.genshin.module.wish;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * UIGF v4.2（原神）与 SRGF v1.0（星穹铁道）互转。
 *
 * <p>导入时保留文件中的 UID，多 UID 文件会拆成同 UID 的多组记录；
 * 导出时按 UID 分组输出。UIGF / SRGF 本身不含「第几抽」与「是否 UP」，
 * 这里附带 pity / is_up 扩展字段，其它工具会忽略，本项目重新导入时可原样恢复。</p>
 */
@Service
public class UigfService {

    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String EXPORT_APP = "SouthAir Genshin";
    private static final String EXPORT_APP_VERSION = "1.0";

    private static final Map<String, String> GENSHIN_TYPE_TO_POOL = new HashMap<>();
    private static final Map<String, String> GENSHIN_POOL_TO_TYPE = new HashMap<>();
    private static final Map<String, String> STARRAIL_TYPE_TO_POOL = new HashMap<>();
    private static final Map<String, String> STARRAIL_POOL_TO_TYPE = new HashMap<>();

    private static final Set<String> GENSHIN_STANDARD_CHARACTERS = new HashSet<>(Arrays.asList(
            "迪卢克", "琴", "莫娜", "七七", "刻晴", "提纳里", "迪希雅", "梦见月瑞希"
    ));
    private static final Set<String> GENSHIN_STANDARD_WEAPONS = new HashSet<>(Arrays.asList(
            "天空之刃", "天空之翼", "天空之傲", "天空之卷", "天空之脊",
            "阿莫斯之弓", "狼的末路", "风鹰剑", "四风原典", "和璞鸢"
    ));
    private static final Set<String> STARRAIL_STANDARD_CHARACTERS = new HashSet<>(Arrays.asList(
            "姬子", "瓦尔特", "布洛妮娅", "杰帕德", "克拉拉", "彦卿", "白露"
    ));
    private static final Set<String> STARRAIL_XINGYUAN_CHARACTERS = new HashSet<>(Arrays.asList(
            "云璃", "银枝", "银狼", "符玄", "刃", "希儿"
    ));
    private static final Set<String> STARRAIL_STANDARD_LIGHT_CONES = new HashSet<>(Arrays.asList(
            "银河铁道之夜", "无可取代的东西", "但战斗还未结束", "以世界之名",
            "制胜的瞬间", "于夜色中", "时节不居"
    ));

    static {
        GENSHIN_TYPE_TO_POOL.put("301", "角色活动");
        GENSHIN_TYPE_TO_POOL.put("302", "武器活动");
        GENSHIN_TYPE_TO_POOL.put("400", "集录祈愿");
        GENSHIN_TYPE_TO_POOL.put("200", "常驻");
        GENSHIN_POOL_TO_TYPE.put("角色活动", "301");
        GENSHIN_POOL_TO_TYPE.put("武器活动", "302");
        GENSHIN_POOL_TO_TYPE.put("集录祈愿", "400");
        GENSHIN_POOL_TO_TYPE.put("常驻", "200");

        STARRAIL_TYPE_TO_POOL.put("11", "角色活动");
        STARRAIL_TYPE_TO_POOL.put("12", "光锥活动");
        STARRAIL_TYPE_TO_POOL.put("21", "联动");
        STARRAIL_TYPE_TO_POOL.put("22", "联动");
        STARRAIL_TYPE_TO_POOL.put("1", "常驻");
        STARRAIL_POOL_TO_TYPE.put("角色活动", "11");
        STARRAIL_POOL_TO_TYPE.put("光锥活动", "12");
        STARRAIL_POOL_TO_TYPE.put("联动", "21");
        STARRAIL_POOL_TO_TYPE.put("常驻", "1");
    }

    private final ObjectMapper objectMapper;

    public UigfService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** 解析 UIGF v4.2 / SRGF v1.0 / UIGF v3 文件，返回当前游戏的记录。 */
    public List<WishRecord> parse(String body, String game) {
        if (!StringUtils.hasText(body)) {
            throw new BusinessException("导入内容为空");
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root == null || !root.isObject()) {
                throw new BusinessException("不是有效的 UIGF / SRGF 文件");
            }
            if (root.has("hk4e") || root.has("hkrpg")) {
                return parseUigfV4(root, GameType.normalize(game));
            }
            if (root.path("list").isArray()) {
                // SRGF v1.0 与旧版 UIGF v3 都是 info + list 结构
                boolean starrail = root.path("info").has("srgf_version")
                        || GameType.isStarRail(game);
                return parseItems(root.path("list"), starrail, root.path("info").path("uid").asText(""));
            }
            throw new BusinessException("未识别的 UIGF / SRGF 结构");
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("UIGF / SRGF 解析失败：" + e.getMessage());
        }
    }

    /**
     * 导出当前游戏的 UIGF v4.2 / SRGF v1.0 JSON。
     *
     * @param uid 指定 UID 时只导出该账号；为空导出全部 UID
     */
    public String export(List<WishRecord> records, String game, String uid) {
        String gameKey = GameType.normalize(game);
        Map<String, List<WishRecord>> groups = groupByUid(records, uid);
        try {
            if (GameType.isStarRail(gameKey)) {
                return exportSrgf(groups);
            }
            return exportUigf(groups);
        } catch (Exception e) {
            throw new BusinessException("导出失败：" + e.getMessage());
        }
    }

    private List<WishRecord> parseUigfV4(JsonNode root, String gameKey) {
        boolean starrail = GameType.isStarRail(gameKey);
        JsonNode section = starrail ? root.path("hkrpg") : root.path("hk4e");
        if (section.isMissingNode() || section.isNull()) {
            throw new BusinessException(starrail
                    ? "文件里没有星穹铁道（hkrpg）记录，请切换游戏后重试"
                    : "文件里没有原神（hk4e）记录，请切换游戏后重试");
        }
        List<WishRecord> records = new ArrayList<>();
        if (section.isArray()) {
            for (JsonNode account : section) {
                records.addAll(parseItems(account.path("gachaLog"), starrail, account.path("uid").asText("")));
            }
        } else {
            records.addAll(parseItems(section.path("gachaLog"), starrail, section.path("uid").asText("")));
        }
        return records;
    }

    private List<WishRecord> parseItems(JsonNode list, boolean starrail, String defaultUid) {
        if (list == null || !list.isArray() || list.size() == 0) {
            throw new BusinessException("文件中没有抽卡记录");
        }
        List<Item> items = new ArrayList<>();
        for (JsonNode node : list) {
            Item item = new Item();
            item.uid = StringUtils.hasText(node.path("uid").asText(""))
                    ? node.path("uid").asText("") : defaultUid;
            item.gachaType = node.path("gacha_type").asText("");
            item.name = node.path("name").asText("");
            item.itemType = node.path("item_type").asText("");
            item.rarity = node.path("rank_type").asInt(node.path("rarity").asInt(3));
            item.time = parseTime(node.path("time").asText(""));
            item.count = Math.max(1, node.path("count").asInt(1));
            item.itemId = node.path("id").asText("");
            item.pool = resolvePool(item.gachaType, starrail);
            item.pityOverride = node.has("pity") ? node.path("pity").asInt(0) : 0;
            item.isUpOverride = node.has("is_up") ? node.path("is_up").asBoolean(false) : null;
            item.captureOverride = node.has("capture_triggered")
                    ? node.path("capture_triggered").asBoolean(false) : null;
            items.add(item);
        }
        applyPity(items);

        List<WishRecord> records = new ArrayList<>();
        for (Item item : items) {
            if (!WishService.isRecordable(item.rarity, item.itemType)) {
                continue;
            }
            WishRecord record = new WishRecord();
            record.setUid(item.uid);
            record.setItemName(item.name);
            record.setItemType(item.itemType);
            record.setPool(item.pool);
            record.setRarity(item.rarity);
            record.setPityCount(item.pityOverride > 0 ? item.pityOverride : Math.max(1, item.pity));
            record.setIsUp(item.isUpOverride != null ? item.isUpOverride : inferIsUp(item, starrail));
            record.setCaptureTriggered(item.captureOverride != null ? item.captureOverride : false);
            record.setWishTime(item.time);
            record.setClientUid(StringUtils.hasText(item.itemId) ? "uigf-" + item.itemId : null);
            record.setEditedAt(System.currentTimeMillis());
            records.add(record);
        }
        if (records.isEmpty()) {
            throw new BusinessException("文件中的记录都被规则过滤（只保留四星角色与五星物品）");
        }
        return records;
    }

    /** 按 UID + 卡池累计抽数，命中五星时记录本次保底并清零。 */
    private void applyPity(List<Item> items) {
        Map<String, List<Item>> byGroup = new LinkedHashMap<>();
        for (Item item : items) {
            byGroup.computeIfAbsent((item.uid == null ? "" : item.uid) + '\u0001' + item.pool,
                    key -> new ArrayList<>()).add(item);
        }
        for (List<Item> group : byGroup.values()) {
            group.sort(Comparator.comparing((Item item) -> item.time)
                    .thenComparingLong(item -> parseLong(item.itemId)));
            int count = 0;
            for (Item item : group) {
                count += item.count;
                item.pity = count;
                if (item.rarity >= 5) {
                    count = 0;
                }
            }
        }
    }

    private String resolvePool(String gachaType, boolean starrail) {
        Map<String, String> mapping = starrail ? STARRAIL_TYPE_TO_POOL : GENSHIN_TYPE_TO_POOL;
        String pool = mapping.get(gachaType);
        if (pool != null) {
            return pool;
        }
        return starrail ? "角色活动" : "角色活动";
    }

    private boolean inferIsUp(Item item, boolean starrail) {
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

    private Map<String, List<WishRecord>> groupByUid(List<WishRecord> records, String uid) {
        Map<String, List<WishRecord>> groups = new LinkedHashMap<>();
        String filter = StringUtils.hasText(uid) ? uid.trim() : null;
        for (WishRecord record : records) {
            String key = StringUtils.hasText(record.getUid()) ? record.getUid().trim() : "100000000";
            if (filter != null && !filter.equals(key)) {
                continue;
            }
            groups.computeIfAbsent(key, value -> new ArrayList<>()).add(record);
        }
        if (groups.isEmpty()) {
            groups.put(filter == null ? "100000000" : filter, new ArrayList<>());
        }
        return groups;
    }

    private String exportUigf(Map<String, List<WishRecord>> groups) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();
        ObjectNode info = root.putObject("info");
        info.put("version", "v4.2");
        info.put("lang", "zh-cn");
        info.put("region_time_zone", 8);
        info.put("export_time", LocalDateTime.now().format(TIME_FORMAT));
        info.put("export_timestamp", Instant.now().getEpochSecond());
        info.put("export_app", EXPORT_APP);
        info.put("export_app_version", EXPORT_APP_VERSION);

        ArrayNode accounts = root.putArray("hk4e");
        for (Map.Entry<String, List<WishRecord>> entry : groups.entrySet()) {
            ObjectNode account = accounts.addObject();
            account.put("uid", entry.getKey());
            account.put("lang", "zh-cn");
            account.put("region_time_zone", 8);
            ArrayNode logs = account.putArray("gachaLog");
            appendEntries(logs, entry.getKey(), entry.getValue(), false);
        }
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    private String exportSrgf(Map<String, List<WishRecord>> groups) throws Exception {
        Map.Entry<String, List<WishRecord>> first = groups.entrySet().iterator().next();
        ObjectNode root = objectMapper.createObjectNode();
        ObjectNode info = root.putObject("info");
        info.put("uid", first.getKey());
        info.put("lang", "zh-cn");
        info.put("region_time_zone", 8);
        info.put("srgf_version", "v1.0");
        info.put("export_timestamp", Instant.now().getEpochSecond());
        info.put("export_app", EXPORT_APP);
        info.put("export_app_version", EXPORT_APP_VERSION);

        ArrayNode logs = root.putArray("list");
        appendEntries(logs, first.getKey(), first.getValue(), true);
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
    }

    private void appendEntries(ArrayNode logs, String uid, List<WishRecord> records, boolean starrail) {
        int index = 0;
        for (WishRecord record : records) {
            ObjectNode node = logs.addObject();
            index++;
            node.put("uid", uid);
            node.put("gacha_type", poolToType(record.getPool(), starrail));
            node.put("item_id", "");
            node.put("count", "1");
            node.put("time", (record.getWishTime() == null ? LocalDateTime.now() : record.getWishTime())
                    .format(TIME_FORMAT));
            node.put("name", record.getItemName());
            node.put("lang", "zh-cn");
            node.put("item_type", record.getItemType());
            node.put("rank_type", String.valueOf(record.getRarity() == null ? 3 : record.getRarity()));
            node.put("id", StringUtils.hasText(record.getClientUid())
                    ? record.getClientUid() : uid + "-" + index);
            // 扩展字段：其它工具会忽略，本项目重新导入时可恢复保底与 UP 判定
            node.put("pity", record.getPityCount() == null ? 1 : record.getPityCount());
            node.put("is_up", Boolean.TRUE.equals(record.getIsUp()));
            node.put("capture_triggered", Boolean.TRUE.equals(record.getCaptureTriggered()));
        }
    }

    private String poolToType(String pool, boolean starrail) {
        Map<String, String> mapping = starrail ? STARRAIL_POOL_TO_TYPE : GENSHIN_POOL_TO_TYPE;
        String type = mapping.get(pool);
        if (type != null) {
            return type;
        }
        return starrail ? "11" : "301";
    }

    private LocalDateTime parseTime(String value) {
        if (!StringUtils.hasText(value)) {
            return LocalDateTime.now();
        }
        String text = value.trim().replace('T', ' ');
        if (text.length() > 19) {
            text = text.substring(0, 19);
        }
        try {
            return LocalDateTime.parse(text, TIME_FORMAT);
        } catch (Exception e) {
            return LocalDateTime.now();
        }
    }

    private long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (Exception e) {
            return 0L;
        }
    }

    private static class Item {
        String uid;
        String gachaType;
        String name;
        String itemType;
        String itemId;
        String pool;
        int rarity;
        int count;
        int pity;
        int pityOverride;
        Boolean isUpOverride;
        Boolean captureOverride;
        LocalDateTime time;
    }
}
