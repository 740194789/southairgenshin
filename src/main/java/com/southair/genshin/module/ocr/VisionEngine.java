package com.southair.genshin.module.ocr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 视觉大模型引擎：调用 OpenAI 兼容的 /chat/completions 多模态接口。
 *
 * <p>通义千问、豆包、智谱、硅基流动、OpenAI 等主流服务都兼容该协议，
 * 只要把 Base URL、API Key、模型名填进配置即可。</p>
 */
@Component
public class VisionEngine {

    private final OcrProperties properties;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;

    public VisionEngine(OcrProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(8000);
        factory.setReadTimeout(Math.max(10, properties.getVision().getTimeoutSeconds()) * 1000);
        this.restTemplate = new RestTemplate(factory);
    }

    public boolean isConfigured() {
        OcrProperties.Vision v = properties.getVision();
        return StringUtils.hasText(v.getBaseUrl())
                && StringUtils.hasText(v.getApiKey())
                && StringUtils.hasText(v.getModel());
    }

    public String getModel() {
        return properties.getVision().getModel();
    }

    /**
     * 识别图片，返回模型输出的文本（资源场景为 JSON 对象，抽卡场景为 JSON 数组）。
     */
    public String recognize(byte[] image, String mimeType, String kind, String game) {
        if (!isConfigured()) {
            throw new BusinessException("视觉模型未配置，请设置 app.ocr.vision.base-url / api-key / model");
        }
        String dataUrl = "data:" + mimeType + ";base64," + Base64.getEncoder().encodeToString(image);

        Map<String, Object> imagePart = new LinkedHashMap<>();
        imagePart.put("type", "image_url");
        Map<String, Object> imageUrl = new LinkedHashMap<>();
        imageUrl.put("url", dataUrl);
        imagePart.put("image_url", imageUrl);

        Map<String, Object> textPart = new LinkedHashMap<>();
        textPart.put("type", "text");
        textPart.put("text", buildPrompt(kind, game));

        List<Object> content = new ArrayList<>();
        content.add(textPart);
        content.add(imagePart);

        Map<String, Object> message = new LinkedHashMap<>();
        message.put("role", "user");
        message.put("content", content);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", properties.getVision().getModel());
        body.put("messages", new ArrayList<>(java.util.Collections.singletonList(message)));
        body.put("temperature", 0);
        body.put("max_tokens", 2000);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(properties.getVision().getApiKey().trim());

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    completionsUrl(), HttpMethod.POST,
                    new HttpEntity<>(objectMapper.writeValueAsString(body), headers),
                    String.class);
            return extractContent(response.getBody());
        } catch (HttpStatusCodeException e) {
            String detail = e.getResponseBodyAsString();
            if (detail != null && detail.length() > 300) {
                detail = detail.substring(0, 300);
            }
            throw new BusinessException("视觉模型调用失败（" + e.getRawStatusCode() + "）：" + detail);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("视觉模型调用异常：" + e.getMessage());
        }
    }

    private String completionsUrl() {
        String base = properties.getVision().getBaseUrl().trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
    }

    private String extractContent(String responseBody) {
        if (!StringUtils.hasText(responseBody)) {
            throw new BusinessException("视觉模型返回内容为空");
        }
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode content = root.path("choices").path(0).path("message").path("content");
            if (content.isTextual()) {
                return content.asText();
            }
            if (content.isArray()) {
                StringBuilder sb = new StringBuilder();
                for (JsonNode part : content) {
                    if (part.isTextual()) {
                        sb.append(part.asText());
                    } else if (part.has("text")) {
                        sb.append(part.path("text").asText());
                    }
                }
                if (sb.length() > 0) {
                    return sb.toString();
                }
            }
            throw new BusinessException("视觉模型返回格式无法解析");
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("视觉模型返回解析失败：" + e.getMessage());
        }
    }

    private String buildPrompt(String kind, String game) {
        boolean starrail = "starrail".equalsIgnoreCase(game);
        if ("wishes".equalsIgnoreCase(kind)) {
            String pools = starrail ? "角色活动、光锥活动、常驻" : "角色活动、武器活动、集录祈愿、常驻";
            return "这是《" + (starrail ? "崩坏：星穹铁道" : "原神") + "》的抽卡记录界面截图。"
                    + "请识别截图中的每一条抽卡记录，字段为：itemName（物品名称，只写名称本身）、"
                    + "rarity（稀有度，只能是 5 或 4）、pool（卡池，必须是 " + pools + " 之一）、"
                    + "pityCount（该条记录在所属卡池中的第几抽，无法判断填 null）、"
                    + "wishTime（yyyy-MM-dd HH:mm:ss，无法判断填 null）。"
                    + "只输出 JSON 数组，不要任何解释、不要代码块标记。格式示例："
                    + "[{\"itemName\":\"刻晴\",\"rarity\":5,\"pool\":\"角色活动\",\"pityCount\":76,\"wishTime\":null}]"
                    + "；如果截图里没有四星及以上记录，输出 []。三星记录不要输出。";
        }
        String currency = starrail ? "星琼" : "原石";
        String credit = starrail ? "信用点" : "摩拉";
        String limited = starrail ? "星轨专票" : "纠缠之缘";
        String standard = starrail ? "星轨通票" : "相遇之缘";
        return "这是《" + (starrail ? "崩坏：星穹铁道" : "原神") + "》的账号资源界面截图。"
                + "请识别其中的四项资源数量：" + currency + "、"+ credit + "、" + limited + "、" + standard + "。"
                + "只输出 JSON 对象，不要任何解释、不要代码块标记。格式："
                + "{\"primogems\":0,\"mora\":0,\"intertwinedFates\":0,\"acquaintedFates\":0}"
                + "。其中 primogems 对应" + currency + "，mora 对应" + credit
                + "，intertwinedFates 对应" + limited + "，acquaintedFates 对应" + standard
                + "。数字只写阿拉伯数字，不要千分位分隔符；识别不到的字段填 null。";
    }
}
