package com.southair.genshin.module.ocr;

import com.southair.genshin.module.ocr.dto.OcrResourceResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 资源截图解析：从 Tesseract 文本 / TSV 中按「名称 → 数量」定位资源数值。
 *
 * <p>游戏背包是网格布局，数量在名称上方，单靠文本顺序不可靠，
 * 因此优先用 TSV 中每个词的坐标做邻近匹配，坐标缺失时退回逐行匹配。</p>
 */
@Component
public class OcrResourceParser {

    /** 字段 key 与识别标签（完整名 + 截断名，兼容 OCR 把长名称拆成两个词） */
    private static final String[][] LABELS = {
            {"primogems", "原石"},
            {"mora", "摩拉"},
            {"intertwinedFates", "纠缠之缘", "纠缠"},
            {"acquaintedFates", "相遇之缘", "相遇"},
            {"genesisCrystals", "创世结晶", "创世"},
            {"heroWit", "大英雄的经验", "大英雄"},
            {"adventurerExp", "冒险家的经验", "冒险家的"},
            {"wandererAdvice", "流浪者的经验", "流浪者的"},
            {"sanctifyingUnction", "祝圣油膏", "祝圣油"},
            {"sanctifyingEssence", "祝圣精华", "祝圣精"}
    };

    /** 数字（允许千分位与「万」缩写） */
    private static final Pattern NUMBER = Pattern.compile("(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?\\s*(万|[wW])?");

    /** 底栏候选里要排除的噪声：时间（:）、分辨率 / 分数（/、x、×）、版本号（.）、百分比 */
    private static final Pattern NUMBER_NOISE = Pattern.compile("[:/xX\\u00d7.%]");
    /** 含拉丁字母的 token（如 Lv、DPI、INF）不是资源数字 */
    private static final Pattern ASCII_LETTER = Pattern.compile("[A-Za-z]");

    /** 背包网格里数量在名称上方，窗口不宜过大，避免命中相邻格子 */
    private static final int ABOVE_LIMIT = 140;
    private static final int BELOW_LIMIT = 100;

    public OcrResourceResult parse(String text, String tsv, int imageWidth, int imageHeight) {
        OcrResourceResult result = new OcrResourceResult();
        result.setText(text == null ? "" : text);
        Map<String, Long> values = new LinkedHashMap<>();

        List<Line> lines = parseLines(tsv);
        if (!lines.isEmpty()) {
            fillByPosition(lines, values);
        }
        if (values.isEmpty() && (text != null) && !text.trim().isEmpty()) {
            fillByLineText(text, values);
        }
        // 背包底栏只有原石 / 摩拉图标和数字，没有文字标签；按最靠下的两个数字兜底
        if (!values.containsKey("primogems") || !values.containsKey("mora")) {
            fillBottomBar(lines, values, imageWidth, imageHeight);
        }
        result.setValues(values);
        List<String> missing = new ArrayList<>();
        for (String[] entry : LABELS) {
            if (!values.containsKey(entry[0])) {
                missing.add(entry[0]);
            }
        }
        result.setMissing(missing);
        return result;
    }

    /* ---------------- TSV 坐标匹配 ---------------- */

    private void fillByPosition(List<Line> lines, Map<String, Long> values) {
        List<Word> numberWords = new ArrayList<>();
        for (Line line : lines) {
            for (Word word : line.words) {
                if (numberValue(word.text) != null) {
                    numberWords.add(word);
                }
            }
        }

        for (String[] entry : LABELS) {
            if (values.containsKey(entry[0])) {
                continue;
            }
            Phrase label = findLabel(lines, entry);
            if (label == null) {
                continue;
            }
            // 顶部资源条：名称与数字在同一行，数字紧跟名称，优先采用
            Word inline = label.inlineNumber();
            if (inline != null) {
                Long inlineValue = numberValue(inline.text);
                if (inlineValue != null) {
                    values.put(entry[0], inlineValue);
                    continue;
                }
            }
            Word best = null;
            int bestScore = Integer.MAX_VALUE;
            for (Word number : numberWords) {
                int dy = label.centerY() - number.centerY();
                int vertical;
                if (dy >= 0) {
                    if (dy > ABOVE_LIMIT) {
                        continue;
                    }
                    vertical = dy;
                } else {
                    if (-dy > BELOW_LIMIT) {
                        continue;
                    }
                    vertical = -dy * 2;
                }
                int dx = Math.abs(label.centerX() - number.centerX());
                if (dx > Math.max(label.width(), number.width) + 120) {
                    continue;
                }
                int score = vertical + dx;
                if (score < bestScore) {
                    bestScore = score;
                    best = number;
                }
            }
            if (best != null) {
                Long value = numberValue(best.text);
                if (value != null) {
                    values.put(entry[0], value);
                }
            }
        }
    }

    private Phrase findLabel(List<Line> lines, String[] entry) {
        for (Line line : lines) {
            Phrase phrase = line.match(entry);
            if (phrase != null) {
                return phrase;
            }
        }
        return null;
    }

    /* ---------------- 纯文本逐行匹配 ---------------- */

    private void fillByLineText(String text, Map<String, Long> values) {
        String[] rows = text.split("\\r?\\n");
        for (String[] entry : LABELS) {
            if (values.containsKey(entry[0])) {
                continue;
            }
            for (int i = 0; i < rows.length; i++) {
                String row = rows[i].replace(" ", "");
                String matched = matchedLabel(row, entry);
                if (matched == null) {
                    continue;
                }
                Long value = numberValue(row.substring(row.indexOf(matched) + matched.length()));
                if (value == null && i + 1 < rows.length) {
                    value = numberValue(rows[i + 1]);
                }
                if (value == null && i > 0) {
                    value = numberValue(rows[i - 1]);
                }
                if (value != null) {
                    values.put(entry[0], value);
                    break;
                }
            }
        }
    }

    /**
     * 原神背包底栏固定为「原石 数量」「摩拉 数量」，但 OCR 通常只能读到数字。
     * 取整张图中最靠下的两个纯数字，按 x 坐标从左到右映射为原石、摩拉。
     */
    private void fillBottomBar(List<Line> lines, Map<String, Long> values, int imageWidth,
                               int imageHeight) {
        List<Word> bottom = findBottomNumbers(lines, imageWidth, imageHeight);
        if (bottom.size() < 2) {
            return;
        }
        Long left = numberValue(bottom.get(0).text);
        Long right = numberValue(bottom.get(1).text);
        if (left != null && !values.containsKey("primogems")) {
            values.put("primogems", left);
        }
        if (right != null && !values.containsKey("mora")) {
            values.put("mora", right);
        }
    }

    /**
     * 底栏两个数字在原图中的位置（按 x 从左到右），依次为原石、摩拉。
     *
     * @return 两个 {left, top, width, height}；识别不到底栏时返回 null
     */
    public int[][] bottomNumberBoxes(String tsv, int imageWidth, int imageHeight) {
        List<Word> bottom = findBottomNumbers(parseLines(tsv), imageWidth, imageHeight);
        if (bottom.size() < 2) {
            return null;
        }
        int[][] boxes = new int[2][];
        for (int i = 0; i < 2; i++) {
            Word word = bottom.get(i);
            boxes[i] = new int[]{word.left, word.top, word.width, word.height};
        }
        return boxes;
    }

    private List<Word> findBottomNumbers(List<Line> lines, int imageWidth, int imageHeight) {
        List<Word> candidates = new ArrayList<>();
        int maxRight = 0;
        for (Line line : lines) {
            for (Word word : line.words) {
                maxRight = Math.max(maxRight, word.right());
                String text = word.text == null ? "" : word.text.trim();
                // 允许数字前后带少量装饰（图标被并进同一个 token 时也能认出来），
                // 但时间、分辨率、版本号、英文标签一律排除
                if (!isBottomNumberToken(text) || numberValue(text) == null) {
                    continue;
                }
                candidates.add(word);
            }
        }
        int width = imageWidth > 0 ? imageWidth : maxRight;
        if (width <= 0 || candidates.size() < 2) {
            return new ArrayList<>();
        }
        // 原石 / 摩拉固定在左下角；右下角的 UID 不能参与配对，
        // 否则 UID 比底栏更低时会把「摩拉 + UID」当成「原石 + 摩拉」
        List<Word> leftHalf = new ArrayList<>();
        for (Word word : candidates) {
            if (word.left <= width * 0.5) {
                leftHalf.add(word);
            }
        }
        if (leftHalf.size() < 2) {
            return new ArrayList<>();
        }
        // 按 top 聚成行：同一行的图标数字 top 基本一致
        leftHalf.sort((a, b) -> a.top == b.top ? Integer.compare(a.left, b.left)
                : Integer.compare(a.top, b.top));
        int tolerance = Math.max(8, (int) Math.round((imageHeight > 0 ? imageHeight : 1000) * 0.012));
        List<List<Word>> rows = new ArrayList<>();
        for (Word word : leftHalf) {
            List<Word> row = rows.isEmpty() ? null : rows.get(rows.size() - 1);
            if (row == null || Math.abs(word.top - row.get(0).top) > tolerance) {
                row = new ArrayList<>();
                rows.add(row);
            }
            row.add(word);
        }
        // 底栏在画面最底部（约占高度 93%），而日志 / 帮助文字可能更靠上，因此行必须足够低；
        // 同一行的两个资源数字中间隔着图标与间距，过近的（如「1」「5」）是普通文本，不是资源
        List<Word> bottom = null;
        for (int i = rows.size() - 1; i >= 0 && bottom == null; i--) {
            List<Word> row = rows.get(i);
            if (row.size() < 2) {
                continue;
            }
            if (imageHeight > 0 && row.get(0).top < imageHeight * 0.88) {
                continue;
            }
            row.sort((a, b) -> Integer.compare(a.left, b.left));
            Word first = row.get(0);
            Word second = row.get(1);
            if (second.left - first.right() < width * 0.02) {
                continue;
            }
            bottom = new ArrayList<>();
            bottom.add(first);
            bottom.add(second);
        }
        return bottom == null ? new ArrayList<>() : bottom;
    }

    private String matchedLabel(String text, String[] labels) {
        for (int i = 1; i < labels.length; i++) {
            if (labels[i] != null && !labels[i].isEmpty() && text.contains(labels[i])) {
                return labels[i];
            }
        }
        return null;
    }

    /** 底栏数字 token：含数字，且不是时间 / 分辨率 / 版本号 / 英文标签 */
    private static boolean isBottomNumberToken(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        if (NUMBER_NOISE.matcher(text).find() || ASCII_LETTER.matcher(text).find()) {
            return false;
        }
        String digits = text.replaceAll("[^0-9]", "");
        return !digits.isEmpty() && digits.length() <= 9;
    }

    private static Long numberValue(String raw) {
        if (raw == null) {
            return null;
        }
        Matcher matcher = NUMBER.matcher(raw.trim());
        while (matcher.find()) {
            String digits = matcher.group(1).replace(",", "");
            String unit = matcher.group(2);
            try {
                long value = Long.parseLong(digits);
                if (unit != null) {
                    value *= 10000L;
                }
                if (value > 0 && value <= 999_999_999L) {
                    return value;
                }
            } catch (NumberFormatException ignored) {
                // 继续找下一个数字
            }
        }
        return null;
    }

    /* ---------------- TSV 行解析 ---------------- */

    private List<Line> parseLines(String tsv) {
        List<Line> lines = new ArrayList<>();
        if (tsv == null || tsv.trim().isEmpty()) {
            return lines;
        }
        Map<String, Line> grouped = new LinkedHashMap<>();
        String[] rows = tsv.split("\\r?\\n");
        for (int i = 1; i < rows.length; i++) {
            String row = rows[i];
            if (row.trim().isEmpty()) {
                continue;
            }
            String[] cols = row.split("\t", -1);
            if (cols.length < 12) {
                continue;
            }
            String wordText = cols[11];
            if (wordText == null || wordText.trim().isEmpty()) {
                continue;
            }
            int left;
            int top;
            int width;
            int height;
            try {
                left = Integer.parseInt(cols[6].trim());
                top = Integer.parseInt(cols[7].trim());
                width = Integer.parseInt(cols[8].trim());
                height = Integer.parseInt(cols[9].trim());
            } catch (NumberFormatException e) {
                continue;
            }
            // 按 页-块-段-行 聚合，同一视觉行内的词要拼起来才能还原完整名称
            String key = cols[1] + "-" + cols[2] + "-" + cols[3] + "-" + cols[4];
            Line line = grouped.get(key);
            if (line == null) {
                line = new Line();
                grouped.put(key, line);
            }
            line.words.add(new Word(wordText, left, top, width, height));
        }
        lines.addAll(grouped.values());
        return lines;
    }

    /** TSV 中的一个词及其坐标 */
    private static class Word {
        private final String text;
        private final int left;
        private final int top;
        private final int width;
        private final int height;

        Word(String text, int left, int top, int width, int height) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }

        int centerX() {
            return left + width / 2;
        }

        int centerY() {
            return top + height / 2;
        }

        int right() {
            return left + width;
        }

        int bottom() {
            return top + height;
        }
    }

    /** 同一行的词集合，用于拼出完整标签并给出标签自身的坐标范围 */
    private static class Line {
        private final List<Word> words = new ArrayList<>();

        /**
         * 在该行内查找标签，返回标签覆盖的坐标范围。
         *
         * <p>同一条 TSV 行可能挤着多个名称，按词拼接后再定位，才能把每个名称
         * 与正上方 / 同一行的数字一一对上。</p>
         */
        Phrase match(String[] aliases) {
            StringBuilder compact = new StringBuilder();
            List<Integer> starts = new ArrayList<>();
            for (Word word : words) {
                starts.add(compact.length());
                compact.append(word.text);
            }
            for (int i = 1; i < aliases.length; i++) {
                String alias = aliases[i];
                if (alias == null || alias.isEmpty()) {
                    continue;
                }
                int index = compact.indexOf(alias);
                if (index >= 0) {
                    return phrase(starts, index, alias.length());
                }
                // 长名称允许 1 个字的识别误差（如「流浪者」被识成「流涂者」）；
                // 短名称不做模糊匹配，避免「祝圣油膏 / 祝圣精华」相互混淆
                if (alias.length() >= 5) {
                    int fuzzy = fuzzyIndex(compact, alias);
                    if (fuzzy >= 0) {
                        return phrase(starts, fuzzy, alias.length());
                    }
                }
            }
            return null;
        }

        /** 逐位置比较，容忍 1 个字的差异 */
        private int fuzzyIndex(CharSequence compact, String alias) {
            int max = compact.length() - alias.length();
            for (int start = 0; start <= max; start++) {
                int diff = 0;
                for (int i = 0; i < alias.length() && diff <= 1; i++) {
                    if (compact.charAt(start + i) != alias.charAt(i)) {
                        diff++;
                    }
                }
                if (diff <= 1) {
                    return start;
                }
            }
            return -1;
        }

        private Phrase phrase(List<Integer> starts, int index, int length) {
            int end = index + length;
            Phrase phrase = new Phrase(this);
            for (int w = 0; w < words.size(); w++) {
                int start = starts.get(w);
                int wordEnd = start + words.get(w).text.length();
                if (wordEnd <= index || start >= end) {
                    continue;
                }
                phrase.add(words.get(w));
            }
            return phrase.words.isEmpty() ? null : phrase;
        }
    }

    /** 标签短语：文字 + 合并后的坐标范围 */
    private static class Phrase {
        private final Line owner;
        private final List<Word> words = new ArrayList<>();
        private int left = Integer.MAX_VALUE;
        private int top = Integer.MAX_VALUE;
        private int right = 0;
        private int bottom = 0;

        Phrase(Line owner) {
            this.owner = owner;
        }

        /** 同一行里紧跟在名称右侧的数字（顶部资源条的布局） */
        Word inlineNumber() {
            Word best = null;
            int bestDx = Integer.MAX_VALUE;
            for (Word word : owner.words) {
                if (numberValue(word.text) == null || word.left < right) {
                    continue;
                }
                int dx = word.left - right;
                if (dx < bestDx) {
                    bestDx = dx;
                    best = word;
                }
            }
            return best;
        }

        void add(Word word) {
            words.add(word);
            left = Math.min(left, word.left);
            top = Math.min(top, word.top);
            right = Math.max(right, word.right());
            bottom = Math.max(bottom, word.bottom());
        }

        int centerX() {
            return (left + right) / 2;
        }

        int centerY() {
            return (top + bottom) / 2;
        }

        int width() {
            return Math.max(1, right - left);
        }
    }
}
