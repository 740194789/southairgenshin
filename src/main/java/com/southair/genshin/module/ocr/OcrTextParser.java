package com.southair.genshin.module.ocr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.module.ocr.dto.OcrWishCandidate;
import com.southair.genshin.module.ocr.dto.OcrWishResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 把识别出的文本解析成抽卡记录候选。
 *
 * <p>文本若是 JSON 则优先按 JSON 解析，否则走基于标签与数字邻近关系的启发式解析。
 * 若带有 TSV，则同时保留每条记录所在文字行的坐标，供前端做头像匹配。
 * 所有结果都只作为「候选」，最终由用户确认。</p>
 */
@Component
public class OcrTextParser {

    /** 五星 / 5星 / ★★★★★ */
    private static final Pattern FIVE_STAR = Pattern.compile("[5五]\\s*[星★]|★{5}|☆{5}");
    /** 四星 / 4星 / ★★★★ */
    private static final Pattern FOUR_STAR = Pattern.compile("[4四]\\s*[星★]|★{4}|☆{4}");
    private static final Pattern TIME = Pattern.compile(
            "\\d{4}\\s*[-/.年]\\s*\\d{1,2}\\s*[-/.月]\\s*\\d{1,2}\\s*日?[\\sT]*\\d{1,2}\\s*:\\s*\\d{2}(?:\\s*:\\s*\\d{2})?");
    private static final Pattern CHINESE_RUN = Pattern.compile("[\\u4e00-\\u9fa5]{2,12}");

    /** 抽卡记录里常见的非物品词，避免被当成物品名称 */
    private static final Set<String> NAME_STOP_WORDS = new HashSet<>(Arrays.asList(
            "抽卡", "卡池", "记录", "详情", "全部", "角色", "武器", "光锥", "常驻", "活动",
            "祈愿", "十连", "单抽", "历史", "五星", "四星", "三星", "获得", "概率", "公示",
            "分享", "统计", "确定", "取消", "上一页", "下一页", "更多", "收起", "展开"));

    private final ObjectMapper objectMapper;

    public OcrTextParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /* ==================== 抽卡记录 ==================== */

    public OcrWishResult parseWishes(String text, String tsv, String game) {
        OcrWishResult result = new OcrWishResult();
        String raw = text == null ? "" : text;
        List<OcrLine> lines = parseTsvLines(tsv);
        if (raw.trim().isEmpty() && !lines.isEmpty()) {
            raw = joinLines(lines);
        }
        result.setRawText(raw);
        if (raw.trim().isEmpty() && lines.isEmpty()) {
            result.getWarnings().add("没有识别到任何文字，请换一张更清晰的截图");
            return result;
        }

        List<OcrWishCandidate> fromJson = wishesFromJson(raw, game);
        if (fromJson != null) {
            result.setCandidates(fromJson);
            if (fromJson.isEmpty()) {
                result.getWarnings().add("截图中没有识别到四星及以上记录");
            }
            return result;
        }

        if (lines.isEmpty()) {
            lines = textLines(raw);
        }
        result.setCandidates(wishesFromLines(lines, game, result));
        if (result.getCandidates().isEmpty()) {
            result.getWarnings().add("未能从文本中解析出抽卡记录，建议手动录入");
        } else {
            result.getWarnings().add("识别结果仅供参考，导入前请核对名称、星级与卡池");
        }
        return result;
    }

    /** tesseract TSV → 每行文字与坐标（level=5 为词，按 block/par/line 合并） */
    private List<OcrLine> parseTsvLines(String tsv) {
        List<OcrLine> lines = new ArrayList<>();
        if (tsv == null || tsv.trim().isEmpty()) {
            return lines;
        }
        String[] rows = tsv.split("\n");
        Map<String, LineBuilder> groups = new LinkedHashMap<>();
        for (int i = 1; i < rows.length; i++) {
            String row = rows[i];
            if (row.trim().isEmpty()) {
                continue;
            }
            String[] cols = row.split("\t", -1);
            if (cols.length < 12) {
                continue;
            }
            int level;
            try {
                level = Integer.parseInt(cols[0].trim());
            } catch (NumberFormatException e) {
                continue;
            }
            if (level != 5) {
                continue;
            }
            String word = cols[11].trim();
            if (word.isEmpty()) {
                continue;
            }
            String key = cols[2].trim() + "-" + cols[3].trim() + "-" + cols[4].trim();
            LineBuilder builder = groups.get(key);
            if (builder == null) {
                builder = new LineBuilder();
                groups.put(key, builder);
            }
            builder.add(cols, word);
        }
        for (LineBuilder builder : groups.values()) {
            lines.add(builder.build());
        }
        lines.sort(Comparator.comparingInt(line -> line.y));
        return lines;
    }

    private String joinLines(List<OcrLine> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(lines.get(i).text);
        }
        return sb.toString();
    }

    /** 没有 TSV 时的兜底：按换行切分，坐标为空 */
    private List<OcrLine> textLines(String text) {
        List<OcrLine> lines = new ArrayList<>();
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (!line.isEmpty()) {
                lines.add(new OcrLine(line, 0, 0, 0, 0));
            }
        }
        return lines;
    }

    /** 单个 TSV 文字行的累积器 */
    private static class LineBuilder {
        private final StringBuilder text = new StringBuilder();
        private int left = Integer.MAX_VALUE;
        private int top = Integer.MAX_VALUE;
        private int right = 0;
        private int bottom = 0;

        void add(String[] cols, String word) {
            int x;
            int y;
            int w;
            int h;
            try {
                x = Integer.parseInt(cols[6].trim());
                y = Integer.parseInt(cols[7].trim());
                w = Integer.parseInt(cols[8].trim());
                h = Integer.parseInt(cols[9].trim());
            } catch (NumberFormatException e) {
                return;
            }
            int x2 = x + Math.max(0, w);
            int y2 = y + Math.max(0, h);
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x2);
            bottom = Math.max(bottom, y2);
            if (text.length() > 0) {
                char prev = text.charAt(text.length() - 1);
                char next = word.charAt(0);
                if (isAsciiWord(prev) && isAsciiWord(next)) {
                    text.append(' ');
                }
            }
            text.append(word);
        }

        private boolean isAsciiWord(char ch) {
            return ch < 128 && Character.isLetterOrDigit(ch);
        }

        OcrLine build() {
            if (left == Integer.MAX_VALUE) {
                return new OcrLine(text.toString(), 0, 0, 0, 0);
            }
            return new OcrLine(text.toString(), left, top,
                    Math.max(0, right - left), Math.max(0, bottom - top));
        }
    }

    /** 一行文字及其在截图中的像素坐标 */
    private static class OcrLine {
        private final String text;
        private final int x;
        private final int y;
        private final int w;
        private final int h;

        OcrLine(String text, int x, int y, int w, int h) {
            this.text = text;
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
        }

        boolean hasBox() {
            return w > 0 && h > 0;
        }
    }

    /** JSON 形式的抽卡记录数组 */
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
            String raw = value.asText("");
            Matcher matcher = Pattern.compile("\\d+").matcher(raw);
            if (matcher.find()) {
                return Integer.parseInt(matcher.group());
            }
        }
        return null;
    }

    /** 纯文本启发式：按行找星级标记，并就近匹配物品名 */
    private List<OcrWishCandidate> wishesFromLines(List<OcrLine> lines, String game, OcrWishResult result) {
        List<OcrWishCandidate> list = new ArrayList<>();
        OcrLine lastRarityLine = null;
        String lastRarityTime = null;
        OcrLine pendingNameLine = null;
        String pendingName = null;
        String pendingTime = null;
        int skipped = 0;

        for (OcrLine line : lines) {
            String text = line.text;
            Integer rarity = detectRarity(text);
            String time = detectTime(text);
            String name = detectItemName(text);

            if (rarity == null && name == null) {
                continue;
            }

            if (rarity != null && name == null) {
                // 星级单独成行：与上一行的名称配对
                if (pendingName != null) {
                    addCandidate(list, pendingName, rarity, time != null ? time : pendingTime,
                            pendingNameLine, line, game);
                    pendingName = null;
                    pendingNameLine = null;
                    pendingTime = null;
                } else {
                    lastRarityLine = line;
                    lastRarityTime = time;
                }
                continue;
            }

            if (rarity != null) {
                addCandidate(list, name, rarity, time, line, line, game);
                lastRarityLine = null;
                lastRarityTime = null;
                continue;
            }

            // 只有名称：先暂存，等下一行星级确认
            if (pendingName != null) {
                skipped++;
            }
            pendingName = name;
            pendingNameLine = line;
            pendingTime = time != null ? time : lastRarityTime;
        }

        // 行尾残留：只有名称能配上一行出现过的星级，否则丢弃，避免凭空造记录
        if (pendingName != null) {
            if (lastRarityLine != null) {
                addCandidate(list, pendingName, detectRarity(lastRarityLine.text),
                        pendingTime, pendingNameLine, lastRarityLine, game);
            } else {
                skipped++;
            }
        }
        if (skipped > 0) {
            result.getWarnings().add("有 " + skipped + " 行未识别到星级，已跳过，请核对截图是否完整");
        }
        return list;
    }

    private void addCandidate(List<OcrWishCandidate> list, String name, Integer rarity, String time,
                              OcrLine nameLine, OcrLine rarityLine, String game) {
        if (rarity == null || rarity < 4) {
            return;
        }
        OcrWishCandidate item = new OcrWishCandidate();
        item.setItemName(name);
        item.setRarity(rarity);
        item.setPool(defaultPool(game));
        item.setWishTime(time);
        OcrLine boxLine = nameLine != null && nameLine.hasBox() ? nameLine
                : (rarityLine != null && rarityLine.hasBox() ? rarityLine : null);
        if (boxLine != null) {
            item.setX(boxLine.x);
            item.setY(boxLine.y);
            item.setW(boxLine.w);
            item.setH(boxLine.h);
        }
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
        return "角色活动";
    }

    private String normalizePool(String pool, String game) {
        if (pool == null) {
            return defaultPool(game);
        }
        String cleaned = pool.replaceAll("[\\s:：]", "");
        List<String> valid = "starrail".equalsIgnoreCase(game)
                ? Arrays.asList("角色活动", "光锥活动", "联动", "常驻")
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
        if (cleaned.contains("联动") || cleaned.contains("联动跃迁")) {
            return "联动";
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
}
