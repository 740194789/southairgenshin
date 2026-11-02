package com.southair.genshin.module.resource;

import com.southair.genshin.module.resource.dto.ResourceRequest;
import com.southair.genshin.module.resource.dto.ResourceVO;

import java.util.ArrayList;
import java.util.List;

/**
 * 账号资源的 CSV 读写（带 BOM，便于 Excel 直接打开）。
 *
 * <p>列：原石/星琼, 摩拉/信用点, 纠缠之缘/星轨专票, 相遇之缘/星轨通票, 每日原石/星琼。空值表示保持原值。</p>
 */
public final class ResourceCsv {

    private static final String BOM = "\uFEFF";
    private static final String[] HEADERS = {
            "原石/星琼", "摩拉/信用点", "纠缠之缘/星轨专票", "相遇之缘/星轨通票", "每日原石/星琼"
    };

    private ResourceCsv() {
    }

    /** 导入模板：只有表头，填入数值后再导入。 */
    public static String header() {
        StringBuilder sb = new StringBuilder(BOM);
        sb.append(join(HEADERS)).append("\r\n");
        return sb.toString();
    }

    public static String write(ResourceVO resource) {
        StringBuilder sb = new StringBuilder(header());
        sb.append(join(new String[]{
                value(resource == null ? null : resource.getPrimogems()),
                value(resource == null ? null : resource.getMora()),
                value(resource == null ? null : resource.getIntertwinedFates()),
                value(resource == null ? null : resource.getAcquaintedFates()),
                value(resource == null ? null : resource.getDailyPrimogems())
        })).append("\r\n");
        return sb.toString();
    }

    /**
     * 解析资源 CSV：只读取第一行数据，空单元格返回 null。
     */
    public static ResourceRequest parse(String text) {
        ResourceRequest request = new ResourceRequest();
        if (text == null || text.trim().isEmpty()) {
            return request;
        }
        String content = text.startsWith(BOM) ? text.substring(1) : text;

        List<String> lines = new ArrayList<>();
        for (String line : content.split("\r?\n")) {
            if (!line.trim().isEmpty()) {
                lines.add(line);
            }
        }
        if (lines.isEmpty()) {
            return request;
        }

        List<String> header = split(lines.get(0));
        int primogems = -1;
        int mora = -1;
        int intertwined = -1;
        int acquainted = -1;
        int daily = -1;
        for (int i = 0; i < header.size(); i++) {
            String name = normalize(header.get(i));
            if (daily < 0 && matches(name, "每日", "daily")) {
                daily = i;
            } else if (primogems < 0 && matches(name, "原石", "星琼", "primogems")) {
                primogems = i;
            } else if (mora < 0 && matches(name, "摩拉", "信用点", "mora")) {
                mora = i;
            } else if (intertwined < 0 && matches(name, "纠缠", "专票", "intertwined")) {
                intertwined = i;
            } else if (acquainted < 0 && matches(name, "相遇", "通票", "acquainted")) {
                acquainted = i;
            }
        }

        if (lines.size() < 2) {
            return request;
        }
        List<String> row = split(lines.get(1));
        request.setPrimogems(number(row, primogems));
        request.setMora(number(row, mora));
        request.setIntertwinedFates(number(row, intertwined));
        request.setAcquaintedFates(number(row, acquainted));
        request.setDailyPrimogems(number(row, daily));
        return request;
    }

    /** 模板 JSON：字段为空，导入时会被拒绝，避免误把模板覆盖到真实数据。 */
    public static String emptyJson() {
        return "{\n"
                + "  \"primogems\": null,\n"
                + "  \"mora\": null,\n"
                + "  \"intertwinedFates\": null,\n"
                + "  \"acquaintedFates\": null,\n"
                + "  \"dailyPrimogems\": null\n"
                + "}\n";
    }

    private static String value(Long number) {
        return number == null ? "" : String.valueOf(number);
    }

    private static String join(String[] values) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < values.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(values[i] == null ? "" : values[i].trim());
        }
        return sb.toString();
    }

    private static List<String> split(String line) {
        List<String> cells = new ArrayList<>();
        for (String cell : line.split(",", -1)) {
            cells.add(cell.trim());
        }
        return cells;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase().replace(" ", "");
    }

    private static boolean matches(String header, String... tokens) {
        for (String token : tokens) {
            if (header.contains(token)) {
                return true;
            }
        }
        return false;
    }

    private static Long number(List<String> row, int index) {
        if (index < 0 || index >= row.size()) {
            return null;
        }
        String text = row.get(index).replace(",", "").replace("，", "").trim();
        if (text.isEmpty() || "-".equals(text)) {
            return null;
        }
        try {
            return Long.valueOf(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
