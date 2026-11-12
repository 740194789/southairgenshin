package com.southair.genshin.module.cloudsync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 电脑端云同步：通过云开发「HTTP 访问服务」调用云函数 syncStore。
 *
 * <p>只负责搬运密文：备份 JSON 在本机用同步码加密后上传，拉取后在内存中解密。
 * 落库、日志里都没有明文、同步码或账号信息。</p>
 */
@Service
public class CloudSyncService {

    /** 与小程序保持一致的单次同步上限（明文字符数） */
    private static final int MAX_TEXT = 400 * 1024;

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public CloudSyncService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(8000);
        factory.setReadTimeout(20000);
        this.restTemplate = new RestTemplate(factory);
    }

    /** 生成新的同步码（云端用加密随机数生成，本机保存） */
    public Map<String, Object> create(String serviceUrl) {
        JsonNode result = call(serviceUrl, baseBody("create"));
        String code = result.path("code").asText("");
        if (code.isEmpty()) {
            throw new BusinessException("云端没有返回同步码，请稍后重试");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("pretty", CloudCrypto.pretty(code));
        return data;
    }

    /**
     * 拉取云端密文并解密。
     *
     * @return exists：同步码是否存在；payload：解密后的备份对象（云端还没数据时为 null）
     */
    public Map<String, Object> pull(String serviceUrl, String code) {
        String normalized = requireCode(code);
        Map<String, Object> body = baseBody("pull");
        body.put("code", normalized);
        JsonNode result = call(serviceUrl, body);
        if (!result.path("exists").asBoolean(true)) {
            throw new BusinessException("同步码不存在，请重新生成或核对");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exists", true);
        data.put("updatedAt", result.path("updatedAt").asLong(0));
        String blob = result.path("payload").asText("");
        if (blob.isEmpty()) {
            data.put("payload", null);
            return data;
        }
        String plain = CloudCrypto.decrypt(blob, normalized);
        try {
            data.put("payload", objectMapper.readTree(plain));
        } catch (Exception e) {
            throw new BusinessException("云端数据解析失败，请稍后重试");
        }
        return data;
    }

    /** 加密后推送；云端已有更新版本时返回 409，由调用方重新拉取合并 */
    public Map<String, Object> push(String serviceUrl, String code, JsonNode payload, Long prevUpdatedAt) {
        String normalized = requireCode(code);
        if (payload == null || !payload.isObject()) {
            throw new BusinessException("没有可同步的数据");
        }
        String plain;
        try {
            plain = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            throw new BusinessException("同步数据整理失败");
        }
        if (plain.length() > MAX_TEXT) {
            throw new BusinessException("本地数据过大，暂时无法同步");
        }

        Map<String, Object> body = baseBody("push");
        body.put("code", normalized);
        body.put("payload", CloudCrypto.encrypt(plain, normalized));
        body.put("prevUpdatedAt", prevUpdatedAt == null || prevUpdatedAt <= 0 ? null : prevUpdatedAt);
        JsonNode result = call(serviceUrl, body);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("updatedAt", result.path("updatedAt").asLong(0));
        return data;
    }

    /** 删除云端密文（解绑并清除） */
    public void delete(String serviceUrl, String code) {
        String normalized = requireCode(code);
        Map<String, Object> body = baseBody("delete");
        body.put("code", normalized);
        call(serviceUrl, body);
    }

    /* ---------------- 云端调用 ---------------- */

    private Map<String, Object> baseBody(String action) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("action", action);
        return body;
    }

    private String requireCode(String code) {
        if (!CloudCrypto.valid(code)) {
            throw new BusinessException("同步码应为 20–64 位字母数字");
        }
        return CloudCrypto.normalize(code);
    }

    /** 只允许 https 的云开发 HTTP 访问服务地址，避免误连其它主机 */
    private void checkServiceUrl(String serviceUrl) {
        if (serviceUrl == null || serviceUrl.trim().isEmpty()) {
            throw new BusinessException("请填写云端服务地址");
        }
        URI uri;
        try {
            uri = URI.create(serviceUrl.trim());
        } catch (IllegalArgumentException e) {
            throw new BusinessException("云端服务地址格式不正确");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new BusinessException("云端服务地址必须是 https");
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!host.endsWith(".tcloudbase.com") && !host.endsWith(".tcb.qcloud.la")) {
            throw new BusinessException("请填写云开发 HTTP 访问服务地址（service.tcloudbase.com）");
        }
    }

    private JsonNode call(String serviceUrl, Map<String, Object> body) {
        checkServiceUrl(serviceUrl);
        String text;
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(body), headers);
            text = restTemplate.postForObject(serviceUrl.trim(), entity, String.class);
        } catch (RestClientException e) {
            throw new BusinessException("无法连接云端同步服务，请检查网络或服务地址");
        } catch (Exception e) {
            throw new BusinessException("云端同步请求失败");
        }
        if (text == null || text.trim().isEmpty()) {
            throw new BusinessException("云端没有返回内容");
        }

        JsonNode node;
        try {
            node = objectMapper.readTree(text);
            // 兼容 HTTP 访问服务把云函数返回值再包一层 body 的情况
            if (!node.has("ok") && node.path("body").isTextual()) {
                node = objectMapper.readTree(node.path("body").asText());
            }
        } catch (Exception e) {
            throw new BusinessException("云端返回内容无法识别，请确认服务地址是否指向 syncStore");
        }
        if (!node.path("ok").asBoolean(false)) {
            String reason = node.path("error").asText("");
            String remoteCode = node.path("code").asText("");
            if ("conflict".equals(remoteCode)) {
                throw new BusinessException(409, "云端数据已被另一台设备更新，请重新同步");
            }
            if ("notfound".equals(remoteCode)) {
                throw new BusinessException("同步码不存在，请重新生成或核对");
            }
            throw new BusinessException(reason.isEmpty() ? "云端同步失败，请稍后重试" : reason);
        }
        return node;
    }
}
