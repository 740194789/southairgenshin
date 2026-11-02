package com.southair.genshin.module.backup;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.southair.genshin.common.BusinessException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

/**
 * 备份文件 SHA-256 校验。
 *
 * <p>先把备份转成「键名排序、无空白」的规范化 JSON，再对除 checksum 字段外的内容做 SHA-256；
 * 这样同一份数据在不同机器 / 不同序列化顺序下都能得到相同结果。旧备份没有 checksum 时跳过校验。</p>
 */
public final class BackupChecksum {

    private BackupChecksum() {
    }

    /** 计算校验值（会忽略 payload 里的 checksum 字段）。 */
    public static String compute(ObjectMapper mapper, Object payload) {
        try {
            JsonNode node = mapper.valueToTree(payload);
            if (node.isObject()) {
                ((ObjectNode) node).remove("checksum");
            }
            String canonical = canonical(node);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new BusinessException(500, "备份校验值计算失败：" + e.getMessage());
        }
    }

    /** 校验备份；checksum 为空（旧备份）或由其它端生成时直接通过。 */
    public static void verify(ObjectMapper mapper, Object payload, String checksum, String checksumApp) {
        if (checksum == null || checksum.trim().isEmpty()) {
            return;
        }
        if (checksumApp != null && !checksumApp.trim().isEmpty()
                && !"southair-web".equalsIgnoreCase(checksumApp.trim())) {
            return;
        }
        String expected = compute(mapper, payload);
        if (!expected.equalsIgnoreCase(checksum.trim())) {
            throw new BusinessException("备份文件校验失败：SHA-256 不一致，文件可能被修改或损坏");
        }
    }

    /** 规范化 JSON：对象键按字典序，数组保持顺序，紧凑输出。 */
    static String canonical(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return "null";
        }
        if (node.isObject()) {
            List<String> names = new ArrayList<>();
            Iterator<String> it = node.fieldNames();
            while (it.hasNext()) {
                names.add(it.next());
            }
            Collections.sort(names);
            StringBuilder sb = new StringBuilder("{");
            for (int i = 0; i < names.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(escape(names.get(i))).append(':').append(canonical(node.get(names.get(i))));
            }
            return sb.append('}').toString();
        }
        if (node.isArray()) {
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < node.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(canonical(node.get(i)));
            }
            return sb.append(']').toString();
        }
        if (node.isTextual()) {
            return escape(node.asText());
        }
        return node.toString();
    }

    /** JSON 字符串转义（与 JSON.stringify 保持一致）。 */
    private static String escape(String text) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            switch (ch) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                default:
                    if (ch < 0x20) {
                        sb.append(String.format("\\u%04x", (int) ch));
                    } else {
                        sb.append(ch);
                    }
            }
        }
        return sb.append('"').toString();
    }
}
