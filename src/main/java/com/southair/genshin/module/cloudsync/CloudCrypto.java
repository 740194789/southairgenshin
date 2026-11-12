package com.southair.genshin.module.cloudsync;

import com.southair.genshin.common.BusinessException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * 云同步的端到端加密工具（与小程序 utils/cloudSync.js 格式完全一致）。
 *
 * <p>同步码只在本机与另一台设备上出现：云端存的是 SHA-256(同步码) 派生的文档 ID，
 * 以及用同步码派生密钥加密后的密文。这里不保存也不输出同步码。</p>
 *
 * <pre>
 * id      = SHA-256("southair-sync-v1|" + code + "|id") 前 32 位
 * encKey  = SHA-256("southair-sync-v1|" + code + "|enc")
 * macKey  = SHA-256("southair-sync-v1|" + code + "|mac")
 * 密文串  = "1.&lt;iv 16 hex&gt;.&lt;base64(密文)&gt;.&lt;mac 32 hex&gt;"
 * 密钥流  = SHA-256(encKey + "|" + iv + "|" + 序号) 的 32 字节
 * mac     = SHA-256(macKey + "|" + iv + "|" + base64(密文)) 前 32 位
 * </pre>
 */
public final class CloudCrypto {

    private static final String PREFIX = "southair-sync-v1|";
    private static final Pattern CODE_PATTERN =
            Pattern.compile("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20,64}$");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private CloudCrypto() {
    }

    /** 去掉分隔符并转大写（同步码可以带短横线方便抄写） */
    public static String normalize(String code) {
        if (code == null) {
            return "";
        }
        return code.toUpperCase().replaceAll("[^0-9A-Z]", "");
    }

    public static boolean valid(String code) {
        return CODE_PATTERN.matcher(normalize(code)).matches();
    }

    /** 展示用：每 4 位一组 */
    public static String pretty(String code) {
        String text = normalize(code);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < text.length(); i += 4) {
            if (sb.length() > 0) {
                sb.append('-');
            }
            sb.append(text, i, Math.min(text.length(), i + 4));
        }
        return sb.toString();
    }

    public static String encrypt(String plainText, String code) {
        String key = normalize(code);
        String encKey = sha256Hex(PREFIX + key + "|enc");
        String macKey = sha256Hex(PREFIX + key + "|mac");
        String iv = randomHex(8);
        String cipher = Base64.getEncoder().encodeToString(
                xorStream(plainText.getBytes(StandardCharsets.UTF_8), encKey, iv));
        String tag = sha256Hex(macKey + "|" + iv + "|" + cipher).substring(0, 32);
        return "1." + iv + "." + cipher + "." + tag;
    }

    public static String decrypt(String blob, String code) {
        String[] parts = blob == null ? new String[0] : blob.split("\\.");
        if (parts.length != 4 || !"1".equals(parts[0])) {
            throw new BusinessException("云端数据格式不正确");
        }
        String key = normalize(code);
        String encKey = sha256Hex(PREFIX + key + "|enc");
        String macKey = sha256Hex(PREFIX + key + "|mac");
        String expected = sha256Hex(macKey + "|" + parts[1] + "|" + parts[2]).substring(0, 32);
        if (!constantTimeEquals(expected, parts[3])) {
            throw new BusinessException("同步码不匹配或云端数据已损坏");
        }
        byte[] cipher;
        try {
            cipher = Base64.getDecoder().decode(parts[2]);
        } catch (IllegalArgumentException e) {
            throw new BusinessException("云端数据格式不正确");
        }
        return new String(xorStream(cipher, encKey, parts[1]), StandardCharsets.UTF_8);
    }

    /* ---------------- 内部实现 ---------------- */

    private static byte[] xorStream(byte[] input, String encKey, String iv) {
        byte[] out = new byte[input.length];
        for (int offset = 0, index = 0; offset < input.length; offset += 32, index++) {
            byte[] block = hexToBytes(sha256Hex(encKey + "|" + iv + "|" + index));
            for (int i = 0; i < 32 && offset + i < input.length; i++) {
                out[offset + i] = (byte) (input[offset + i] ^ block[i]);
            }
        }
        return out;
    }

    private static String randomHex(int bytes) {
        byte[] buffer = new byte[bytes];
        RANDOM.nextBytes(buffer);
        return toHex(buffer);
    }

    private static String sha256Hex(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return toHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new BusinessException(500, "加密组件不可用");
        }
    }

    private static String toHex(byte[] bytes) {
        char[] chars = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            chars[i * 2] = HEX[value >>> 4];
            chars[i * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(chars);
    }

    private static byte[] hexToBytes(String text) {
        byte[] bytes = new byte[text.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) {
            return false;
        }
        int diff = 0;
        for (int i = 0; i < a.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }
}
