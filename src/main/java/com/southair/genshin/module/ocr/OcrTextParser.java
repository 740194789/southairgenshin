package com.southair.genshin.module.ocr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.module.ocr.dto.OcrResourceResult;
import com.southair.genshin.module.ocr.dto.OcrWishCandidate;
import com.southair.genshin.module.ocr.dto.OcrWishResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 把识别出的文本解析成结构化数据。
 *
 * <p>视觉模型会直接返回 JSON，优先按 JSON 解析；Tesseract / 浏览器 OCR 返回纯文本，
 * 走基于标签与数字邻近关系的启发式解析。所有结果都只作为「候选」，最终由用户确认。</p>
 */
@Component
public class OcrTextParser {

    /** 千分位或纯数字 */
    private static final Pattern NUMBER = Pattern.compile("(\\d{1,3}(?:[,，]\\d{3})+|\\d+)");
    /** 五星 / 5星 / ★★★★★ */
    private static final Pattern FIVE_STAR = Pattern.compile("[5五]\\s*[星★]|★{5}|☆{5}");
    /** 四星 / 4星 / ★★★★ */
    private static final Pattern FOUR_STAR = Pattern.compile("[4四]\\s*[星★]|★{4}|☆{4}");
    private static final Pattern TIME = Pattern.compile(
            "\\d{4}\\s*[-/.年]\\s*\\d{1,2}\\s*[-/.月]\\s*\\d{1,2}\\s*日?[\\sT]*\\d{1,2}\\s*:\\s*\\d{2}(?:\\s*:\\s*\\d{2})?");
    private static final Pattern CHINESE_RUN = Pattern.compile("[\\u4e00-\\u9fa5]{2,12}");
    private static final Pattern PITY = Pattern.compile("第\\s*(\\d{1,3})\\s*抽|(\\d{1,3})\\s*抽");

    /** 抽卡记录里常见的非物品词，避免被当成物品名称 */
    private static final Set<String> NAME_STOP_WORDS = new HashSet<>(Arrays.asList(
            "抽卡", "卡池", "记录", "详情", "全部", "角色", "武器", "光锥", "常驻", "活动",
            "祈愿", "十连", "单抽", "历史", "五星", "四星", "三星", "获得", "概率", "公示",
            "分享", "统计", "确定", "取消", "上一页", "下一页", "更多", "收起", "展开"));

    private final ObjectMapper objectMapper;

    public OcrTextParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /* ==================== 资源 ==================== */

    public OcrResourceResult parseResource(String text, String game) {
        OcrResourceResult result = new OcrResourceResult();
        result.setRawText(text == null ? "" : text);
        if (text == null || text.trim().isEmpty()) {
            result.getWarnings().add("没有识别到任何文字，请换一张更清晰的截图");
            return result;
        }

        if (applyResourceJson(text, game, result)) {
            return result;
        }

        String normalized = normalize(text);
        Map<String, List<String>> aliases = resourceAliases(game);
        Set<Integer> usedPositions = new HashSet<>();
        Map<String, Long> values = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> entry : aliases.entrySet()) {
            Long value = findValueNearLabels(normalized, entry.getValue(), usedPositions);
            if (value != null) {
                values.put(entry.getKey(), value);
            }
        }
        applyPositionFallback(normalized, game, aliases, values, usedPositions, result);

        result.setPrimogems(values.get("primogems"));
        result.setMora(values.get("mora"));
        result.setIntertwinedFates(values.get("intertwinedFates"));
        result.setAcquaintedFates(values.get("acquaintedFates"));

        if (values.isEmpty()) {
            result.getWarnings().add("未能从文本中定位到资源数量，请手动填写或换用视觉模型识别");
        } else if (values.size() < 4) {
            result.getWarnings().add("只识别到 " + values.size() + " 项资源，其余请手动补全");
        }
        return result;
    }

    /** 视觉模型返回的 JSON：{primogems: 123, mora: ..., ...} */
    private boolean applyResourceJson(String text, String game, OcrResourceResult result) {
        String trimmed = text.trim();
        int brace = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (brace < 0 || end <= brace) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(trimmed.substring(brace, end + 1));
            if (root == null || !root.isObject()) {
                return false;
            }
            Map<String, List<String>> aliases = resourceAliases(game);
            boolean any = false;
            for (Map.Entry<String, List<String>> entry : aliases.entrySet()) {
                Long value = readLong(root, entry.getKey(), entry.getValue());
                if (value != null) {
                    setResourceField(result, entry.getKey(), value);
                    any = true;
                }
            }
            return any;
        } catch (Exception e) {
            return false;
        }
    }

    private Long readLong(JsonNode root, String field, List<String> aliases) {
        List<String> keys = new ArrayList<>();
        keys.add(field);
        keys.addAll(aliases);
        for (String key : keys) {
            JsonNode node = root.get(key);
            if (node == null || node.isNull()) {
                continue;
            }
            if (node.isNumber()) {
                return node.asLong();
            }
            String raw = node.asText("").trim();
            if (raw.isEmpty() || "null".equalsIgnoreCase(raw)) {
                continue;
            }
            Long parsed = firstNumber(raw);
            if (parsed != null) {
                return parsed;
            }
        }
        return null;
    }

    private void setResourceField(OcrResourceResult result, String field, Long value) {
        switch (field) {
            case "primogems":
                result.setPrimogems(value);
                break;
            case "mora":
                result.setMora(value);
                break;
            case "intertwinedFates":
                result.setIntertwinedFates(value);
                break;
            case "acquaintedFates":
                result.setAcquaintedFates(value);
                break;
            default:
                break;
        }
    }

    private Map<String, List<String>> resourceAliases(String game) {
        Map<String, List<String>> map = new LinkedHashMap<>();
        if ("starrail".equalsIgnoreCase(game)) {
            map.put("primogems", Arrays.asList("星琼", "星琼数"));
            map.put("mora", Arrays.asList("信用点"));
            map.put("intertwinedFates", Arrays.asList("星轨专票", "专票"));
            map.put("acquaintedFates", Arrays.asList("星轨通票", "通票"));
        } else {
            map.put("primogems", Arrays.asList("原石", "原石数"));
            map.put("mora", Arrays.asList("摩拉"));
            map.put("intertwinedFates", Arrays.asList("纠缠之缘", "纠缠"));
            map.put("acquaintedFates", Arrays.asList("相遇之缘", "相遇"));
        }
        return map;
    }

    /**
     * 位置兜底：只缺一项资源、且恰好只剩一个未使用的数字时，按位置补上。
     *
     * <p>例如「星琼」被 OCR 误识别成字母，但数值仍在，就把它当作第一项资源的数值；
     * 结果会带上警告，由用户确认。</p>
     */
    private void applyPositionFallback(String text, String game, Map<String, List<String>> aliases,
                                       Map<String, Long> values, Set<Integer> usedPositions,
                                       OcrResourceResult result) {
        List<String> missing = new ArrayList<>();
        for (String key : aliases.keySet()) {
            if (!values.containsKey(key)) {
                missing.add(key);
            }
        }
        if (missing.size() != 1) {
            return;
        }
        List<Candidate> unused = new ArrayList<>();
        Matcher matcher = NUMBER.matcher(text);
        while (matcher.find()) {
            if (usedPositions.contains(matcher.start())) {
                continue;
            }
            Long value = toLong(matcher.group());
            if (value != null) {
                unused.add(new Candidate(matcher.start(), value, matcher.start()));
            }
        }
        if (unused.size() != 1) {
            return;
        }
        Candidate only = unused.get(0);
        String field = missing.get(0);
        values.put(field, only.value);
        usedPositions.add(only.position);
        result.getWarnings().add(resourceLabel(field, game) + " 未直接匹配到，已按位置推断为 "
                + only.value + "，请核对");
    }

    private String resourceLabel(String field, String game) {
        boolean starrail = "starrail".equalsIgnoreCase(game);
        switch (field) {
            case "primogems":
                return starrail ? "星琼" : "原石";
            case "mora":
                return starrail ? "信用点" : "摩拉";
            case "intertwinedFates":
                return starrail ? "星轨专票" : "纠缠之缘";
            case "acquaintedFates":
                return starrail ? "星轨通票" : "相遇之缘";
            default:
                return field;
        }
    }

    /**
     * 在标签附近找最可能的数字。
     *
     * <p>优先取与标签同一行的数字，其次取上下相邻行，最后才按全局字符距离兜底，
     * 避免把上一行的数字错配给下一行的标签。</p>
     */
    private Long findValueNearLabels(String text, List<String> aliases, Set<Integer> usedPositions) {
        Candidate best = null;

        for (String alias : aliases) {
            int from = 0;
            while (true) {
                int idx = text.indexOf(alias, from);
                if (idx < 0) {
                    break;
                }
                from = idx + alias.length();
                int labelEnd = idx + alias.length();

                int lineStart = text.lastIndexOf('\n', idx) + 1;
                int lineEnd = text.indexOf('\n', labelEnd);
                if (lineEnd < 0) {
                    lineEnd = text.length();
                }

                // 同一行：标签之后优先，标签之前次之
                best = mergeBest(best, scan(text, labelEnd, lineEnd, usedPositions, 1, labelEnd));
                best = mergeBest(best, scan(text, lineStart, idx, usedPositions, 3, labelEnd));

                // 上一行 / 下一行
                int prevStart = lineStart > 0 ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0;
                int nextEnd = text.indexOf('\n', lineEnd + 1);
                nextEnd = nextEnd < 0 ? text.length() : nextEnd;
                if (prevStart < lineStart) {
                    best = mergeBest(best, scan(text, prevStart, lineStart - 1, usedPositions, 6, labelEnd));
                }
                if (nextEnd > lineEnd) {
                    best = mergeBest(best, scan(text, lineEnd + 1, nextEnd, usedPositions, 5, labelEnd));
                }

                // 全局兜底：允许跨行但距离受限
                int windowStart = Math.max(0, idx - 30);
                int windowEnd = Math.min(text.length(), labelEnd + 30);
                best = mergeBest(best, scan(text, windowStart, windowEnd, usedPositions, 9, labelEnd));
            }
        }

        if (best == null) {
            return null;
        }
        usedPositions.add(best.position);
        return best.value;
    }

    private Candidate mergeBest(Candidate current, Candidate candidate) {
        if (candidate == null) {
            return current;
        }
        return current == null || candidate.score < current.score ? candidate : current;
    }

    /**
     * 在 [from, to) 区间内挑选数字。
     *
     * @param weight    区间权重，越小越优先
     * @param labelEnd  标签结束位置，用于计算同行内距离
     */
    private Candidate scan(String text, int from, int to, Set<Integer> usedPositions,
                           int weight, int labelEnd) {
        if (from >= to || from < 0) {
            return null;
        }
        Candidate best = null;
        Matcher matcher = NUMBER.matcher(text.substring(from, to));
        while (matcher.find()) {
            int start = from + matcher.start();
            int endPos = from + matcher.end();
            if (usedPositions.contains(start)) {
                continue;
            }
            Long value = toLong(matcher.group());
            if (value == null) {
                continue;
            }
            int distance = start >= labelEnd ? start - labelEnd : labelEnd - endPos;
            int score = weight * 100 + Math.max(0, distance);
            if (best == null || score < best.score) {
                best = new Candidate(start, value, score);
            }
        }
        return best;
    }

    private static class Candidate {
        private final int position;
        private final long value;
        private final int score;

        Candidate(int position, long value, int score) {
            this.position = position;
            this.value = value;
            this.score = score;
        }
    }

    /* ==================== 抽卡记录 ==================== */

    public OcrWishResult parseWishes(String text, String game) {
        OcrWishResult result = new OcrWishResult();
        result.setRawText(text == null ? "" : text);
        if (text == null || text.trim().isEmpty()) {
            result.getWarnings().add("没有识别到任何文字，请换一张更清晰的截图");
            return result;
        }

        List<OcrWishCandidate> fromJson = wishesFromJson(text, game);
        if (fromJson != null) {
            result.setCandidates(fromJson);
            if (fromJson.isEmpty()) {
                result.getWarnings().add("截图中没有识别到四星及以上记录");
            }
            return result;
        }

        result.setCandidates(wishesFromLines(text, game, result));
        if (result.getCandidates().isEmpty()) {
            result.getWarnings().add("未能从文本中解析出抽卡记录，建议改用视觉模型识别");
        } else {
            result.getWarnings().add("纯文本识别结果仅供参考，导入前请核对物品名称、星级与卡池");
        }
        return result;
    }

    /** 视觉模型返回的 JSON 数组 */
    private List<OcrWishCandidate> wishesFromJson(String text, String game) {
        String trimmed = text.trim();
        int start = trimmed.indexOf('[');
        int end = trimmed.lastIndexOf(']');
        if (start < 0 || end <= start) {
            return null;
        }
        try {
            JsonNode array = objectMapper.readTree(trimmed.substring(start, end + 1));
            if (array == null || !array.isArray()) {
                return null;
            }
            List<OcrWishCandidate> list = new ArrayList<>();
            for (JsonNode node : array) {
                String name = textOf(node, "itemName", "name", "物品名称", "名称");
                if (name == null || name.trim().isEmpty()) {
                    continue;
                }
                Integer rarity = intOf(node, "rarity", "稀有度", "星级");
                if (rarity == null || rarity < 4) {
                    continue;
                }
                OcrWishCandidate item = new OcrWishCandidate();
                item.setItemName(name.trim());
                item.setRarity(rarity >= 5 ? 5 : 4);
                item.setPool(normalizePool(textOf(node, "pool", "卡池"), game));
                item.setPityCount(intOf(node, "pityCount", "pity", "抽数"));
                item.setWishTime(normalizeTime(textOf(node, "wishTime", "time", "时间")));
                list.add(item);
            }
            return list;
        } catch (Exception e) {
            return null;
        }
    }

    private String textOf(JsonNode node, String... keys) {
        for (String key : keys) {
            JsonNode value = node.get(key);
            if (value != null && !value.isNull() && value.isValueNode()) {
                return value.asText();
            }
        }
        return null;
    }

    private Integer intOf(JsonNode node, String... keys) {
        for (String key : keys) {
            JsonNode value = node.get(key);
            if (value == null || value.isNull()) {
                continue;
            }
            if (value.isNumber()) {
                return value.asInt();
            }
            Long parsed = firstNumber(value.asText(""));
            if (parsed != null) {
                return parsed.intValue();
            }
        }
        return null;
    }

    /** 纯文本启发式：按行找星级标记，并就近匹配物品名 */
    private List<OcrWishCandidate> wishesFromLines(String text, String game, OcrWishResult result) {
        List<OcrWishCandidate> list = new ArrayList<>();
        String[] lines = text.split("\\r?\\n");
        Integer lastRarity = null;
        String lastTime = null;
        String pendingName = null;
        String pendingTime = null;
        int skipped = 0;

        for (String rawLine : lines) {
            String line = rawLine.trim();
            if (line.isEmpty()) {
                continue;
            }
            Integer rarity = detectRarity(line);
            String time = detectTime(line);
            String name = detectItemName(line);

            if (rarity == null && name == null) {
                continue;
            }

            if (rarity != null && name == null) {
                // 星级单独成行：与上一行的名称配对
                if (pendingName != null) {
                    addCandidate(list, pendingName, rarity, time != null ? time : pendingTime, game);
                    pendingName = null;
                    pendingTime = null;
                } else {
                    lastRarity = rarity;
                    lastTime = time;
                }
                continue;
            }

            if (rarity != null) {
                addCandidate(list, name, rarity, time, game);
                lastRarity = null;
                lastTime = null;
                continue;
            }

            // 只有名称：先暂存，等下一行星级确认
            if (pendingName != null) {
                skipped++;
            }
            pendingName = name;
            pendingTime = time != null ? time : lastTime;
        }

        // 行尾残留：只有名称能配上一行出现过的星级，否则丢弃，避免凭空造记录
        if (pendingName != null) {
            if (lastRarity != null) {
                addCandidate(list, pendingName, lastRarity, pendingTime, game);
            } else {
                skipped++;
            }
        }
        if (skipped > 0) {
            result.getWarnings().add("有 " + skipped + " 行未识别到星级，已跳过，请核对截图是否完整");
        }
        return list;
    }

    private void addCandidate(List<OcrWishCandidate> list, String name, Integer rarity, String time, String game) {
        if (rarity == null || rarity < 4) {
            return;
        }
        OcrWishCandidate item = new OcrWishCandidate();
        item.setItemName(name);
        item.setRarity(rarity);
        item.setPool(defaultPool(game));
        item.setWishTime(time);
        list.add(item);
    }

    private Integer detectRarity(String line) {
        if (FIVE_STAR.matcher(line).find()) {
            return 5;
        }
        if (FOUR_STAR.matcher(line).find()) {
            return 4;
        }
        return null;
    }

    private String detectTime(String line) {
        Matcher matcher = TIME.matcher(line);
        if (!matcher.find()) {
            return null;
        }
        return normalizeTime(matcher.group());
    }

    private String detectItemName(String line) {
        // 先去掉时间、星级标记和标点，避免「四星」「★★★★」被当成物品名
        String cleaned = TIME.matcher(line).replaceAll(" ");
        cleaned = cleaned.replaceAll("[1-9]\\s*[星★]", " ")
                .replaceAll("[三四五六]\\s*[星★]", " ")
                .replaceAll("[★☆]+", " ")
                .replaceAll("\\d", "")
                .replaceAll("[\\s:：,，.。%+\\-—|/\\\\()\\[\\]【】<>《》]", "");
        Matcher matcher = CHINESE_RUN.matcher(cleaned);
        String best = null;
        while (matcher.find()) {
            String candidate = stripStopWords(matcher.group());
            if (candidate.length() < 2) {
                continue;
            }
            if (best == null || candidate.length() > best.length()) {
                best = candidate;
            }
        }
        return best;
    }

    /** 去掉「抽卡」「卡池」等界面词，保留真正的物品名 */
    private String stripStopWords(String candidate) {
        String value = candidate;
        for (String stop : NAME_STOP_WORDS) {
            value = value.replace(stop, "");
        }
        return value;
    }

    private String defaultPool(String game) {
        return "starrail".equalsIgnoreCase(game) ? "角色活动" : "角色活动";
    }

    private String normalizePool(String pool, String game) {
        if (pool == null) {
            return defaultPool(game);
        }
        String cleaned = pool.replaceAll("[\\s:：]", "");
        List<String> valid = "starrail".equalsIgnoreCase(game)
                ? Arrays.asList("角色活动", "光锥活动", "常驻")
                : Arrays.asList("角色活动", "武器活动", "集录祈愿", "常驻");
        for (String item : valid) {
            if (cleaned.contains(item)) {
                return item;
            }
        }
        if (cleaned.contains("武器")) {
            return "武器活动";
        }
        if (cleaned.contains("光锥")) {
            return "光锥活动";
        }
        if (cleaned.contains("常驻") || cleaned.contains("标准")) {
            return "常驻";
        }
        if (cleaned.contains("集录") || cleaned.contains("混")) {
            return "集录祈愿";
        }
        return defaultPool(game);
    }

    /** 把 2026/10/29 12:33 之类的写法统一成 yyyy-MM-dd HH:mm:ss */
    private String normalizeTime(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        Matcher matcher = Pattern.compile(
                "(\\d{4})\\s*[-/.年]\\s*(\\d{1,2})\\s*[-/.月]\\s*(\\d{1,2})\\s*日?[\\sT]*(\\d{1,2})\\s*:\\s*(\\d{2})(?:\\s*:\\s*(\\d{2}))?")
                .matcher(raw);
        if (!matcher.find()) {
            return null;
        }
        String second = matcher.group(6) == null ? "00" : matcher.group(6);
        return matcher.group(1) + "-" + pad(matcher.group(2)) + "-" + pad(matcher.group(3))
                + " " + pad(matcher.group(4)) + ":" + pad(matcher.group(5)) + ":" + pad(second);
    }

    private String pad(String value) {
        return value.length() == 1 ? "0" + value : value;
    }

    /* ==================== 通用 ==================== */

    /** 全角转半角，便于正则匹配 */
    private String normalize(String text) {
        StringBuilder sb = new StringBuilder(text.length());
        for (char ch : text.toCharArray()) {
            // 全角 ASCII（含全角数字）转半角
            if (ch >= '\uFF01' && ch <= '\uFF5E') {
                sb.append((char) (ch - 0xFEE0));
            } else if (ch == '\u3000') {
                sb.append(' ');
            } else {
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    private Long firstNumber(String text) {
        Matcher matcher = NUMBER.matcher(normalize(text));
        return matcher.find() ? toLong(matcher.group()) : null;
    }

    private Long toLong(String raw) {
        if (raw == null) {
            return null;
        }
        String digits = raw.replaceAll("[,，\\s]", "");
        if (digits.isEmpty() || digits.length() > 12) {
            return null;
        }
        try {
            return Long.parseLong(digits);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
