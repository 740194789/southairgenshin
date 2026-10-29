package com.southair.genshin.module.wish;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 抽卡记录的 CSV 读写（带 BOM，便于 Excel 直接打开）。
 *
 * <p>列：抽卡时间, 物品名称, 星级, 类型, 卡池, 是否UP, 保底计数, 备注, 捕获明光</p>
 */
public final class WishCsv {

    private static final String BOM = "\uFEFF";
    private static final String[] HEADERS = {"抽卡时间", "物品名称", "星级", "类型", "卡池", "是否UP", "保底计数", "备注", "捕获明光"};

    private static final DateTimeFormatter OUTPUT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter INPUT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter INPUT_TIME_MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter INPUT_TIME_ISO_SECOND = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final DateTimeFormatter INPUT_TIME_ISO_MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");
    private static final DateTimeFormatter INPUT_TIME_SLASH = DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss");

    private WishCsv() {
    }

    public static String write(List<WishRecord> records) {
        StringBuilder sb = new StringBuilder(BOM);
        sb.append(join(HEADERS)).append("\r\n");
        for (WishRecord record : records) {
            sb.append(join(new String[]{
                    record.getWishTime() == null ? "" : OUTPUT_TIME.format(record.getWishTime()),
                    safe(record.getItemName()),
                    record.getRarity() == null ? "" : String.valueOf(record.getRarity()),
                    safe(record.getItemType()),
                    safe(record.getPool()),
                    Boolean.TRUE.equals(record.getIsUp()) ? "UP" : "否",
                    record.getPityCount() == null ? "" : String.valueOf(record.getPityCount()),
                    safe(record.getNote()),
                    Boolean.TRUE.equals(record.getCaptureTriggered()) ? "是" : "否"
            })).append("\r\n");
        }
        return sb.toString();
    }

    public static List<WishRecord> parse(String text) {
        if (text == null) {
            return Collections.emptyList();
        }
        if (text.startsWith(BOM)) {
            text = text.substring(1);
        }

        List<List<String>> rows = readRows(text);
        if (rows.isEmpty()) {
            return Collections.emptyList();
        }

        Map<String, Integer> index = new HashMap<>();
        List<String> header = rows.get(0);
        for (int i = 0; i < header.size(); i++) {
            index.put(normalizeHeader(header.get(i)), i);
        }

        List<WishRecord> records = new ArrayList<>();
        for (int r = 1; r < rows.size(); r++) {
            List<String> row = rows.get(r);
            if (isBlankRow(row)) {
                continue;
            }
            WishRecord record = new WishRecord();
            record.setWishTime(parseTime(cell(row, index, "time")));
            record.setItemName(cell(row, index, "name"));
            record.setRarity(parseInt(cell(row, index, "rarity")));
            record.setItemType(cell(row, index, "type"));
            record.setPool(cell(row, index, "pool"));
            record.setIsUp(parseBoolean(cell(row, index, "isup")));
            record.setPityCount(parseInt(cell(row, index, "pity")));
            record.setNote(cell(row, index, "note"));
            record.setCaptureTriggered(parseBoolean(cell(row, index, "capture")));
            records.add(record);
        }
        return records;
    }

    private static String join(String[] values) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(escape(values[i]));
        }
        return sb.toString();
    }

    private static String escape(String value) {
        String text = safe(value);
        if (text.indexOf(',') < 0 && text.indexOf('"') < 0
                && text.indexOf('\n') < 0 && text.indexOf('\r') < 0) {
            return text;
        }
        return '"' + text.replace("\"", "\"\"") + '"';
    }

    private static List<List<String>> readRows(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;

        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (quoted) {
                if (ch == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(ch);
                }
            } else if (ch == '"') {
                quoted = true;
            } else if (ch == ',') {
                row.add(cell.toString());
                cell.setLength(0);
            } else if (ch == '\n') {
                row.add(cell.toString());
                cell.setLength(0);
                rows.add(row);
                row = new ArrayList<>();
            } else if (ch != '\r') {
                cell.append(ch);
            }
        }
        if (cell.length() > 0 || !row.isEmpty()) {
            row.add(cell.toString());
            rows.add(row);
        }
        return rows;
    }

    private static String normalizeHeader(String value) {
        String header = safe(value).trim().toLowerCase().replace(" ", "");
        if (header.equals("抽卡时间") || header.equals("时间") || header.equals("wishtime")
                || header.equals("time")) {
            return "time";
        }
        if (header.equals("物品名称") || header.equals("名称") || header.equals("抽到的物品")
                || header.equals("itemname") || header.equals("name")) {
            return "name";
        }
        if (header.equals("星级") || header.equals("rarity")) {
            return "rarity";
        }
        if (header.equals("类型") || header.equals("itemtype") || header.equals("type")) {
            return "type";
        }
        if (header.equals("卡池") || header.equals("pool")) {
            return "pool";
        }
        if (header.equals("是否up") || header.equals("up") || header.equals("isup")) {
            return "isup";
        }
        if (header.equals("保底计数") || header.equals("保底") || header.equals("pity")
                || header.equals("pitycount")) {
            return "pity";
        }
        if (header.equals("备注") || header.equals("note") || header.equals("remark")) {
            return "note";
        }
        if (header.equals("捕获明光") || header.equals("capture")
                || header.equals("capturetriggered") || header.equals("captured")) {
            return "capture";
        }
        return header;
    }

    private static String cell(List<String> row, Map<String, Integer> index, String key) {
        Integer at = index.get(key);
        if (at == null || at >= row.size()) {
            return null;
        }
        String value = row.get(at);
        if (value == null) {
            return null;
        }
        value = value.trim();
        return value.isEmpty() ? null : value;
    }

    private static boolean isBlankRow(List<String> row) {
        for (String value : row) {
            if (value != null && !value.trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private static LocalDateTime parseTime(String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim();
        if (text.isEmpty()) {
            return null;
        }
        DateTimeFormatter[] formatters = {
                INPUT_TIME, INPUT_TIME_MINUTE, INPUT_TIME_ISO_SECOND,
                INPUT_TIME_ISO_MINUTE, INPUT_TIME_SLASH
        };
        for (DateTimeFormatter formatter : formatters) {
            try {
                return LocalDateTime.parse(text, formatter);
            } catch (DateTimeParseException ignored) {
                // 尝试下一种格式
            }
        }
        return null;
    }

    private static Integer parseInt(String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim();
        if (text.isEmpty()) {
            return null;
        }
        if (text.indexOf('★') >= 0) {
            int stars = 0;
            for (int i = 0; i < text.length(); i++) {
                if (text.charAt(i) == '★') {
                    stars++;
                }
            }
            return stars > 0 ? stars : null;
        }
        try {
            return Integer.valueOf(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Boolean parseBoolean(String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim().toLowerCase();
        if (text.isEmpty()) {
            return null;
        }
        return text.equals("true") || text.equals("1") || text.equals("是")
                || text.equals("up") || text.equals("up内") || text.equals("y");
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
