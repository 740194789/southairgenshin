package com.southair.genshin.module.calendar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.southair.genshin.common.BusinessException;
import com.southair.genshin.common.GameType;
import com.southair.genshin.common.R;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.InputStream;

/**
 * 内置版本 / 卡池日历，完全离线读取 classpath 下的 calendar/banners.json。
 *
 * <p>只返回原始数据，剩余天数与当前卡池由前端按本地日期计算。</p>
 */
@RestController
@RequestMapping("/api/calendar")
public class CalendarController {

    private final ObjectMapper objectMapper;
    private volatile JsonNode cache;

    public CalendarController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public R<JsonNode> calendar(@RequestParam(defaultValue = "genshin") String game) {
        JsonNode root = load();
        JsonNode node = root.path(GameType.normalize(game));
        if (node.isMissingNode() || node.isNull()) {
            return R.ok(objectMapper.createObjectNode());
        }
        return R.ok(node);
    }

    private JsonNode load() {
        JsonNode local = cache;
        if (local != null) {
            return local;
        }
        synchronized (this) {
            if (cache != null) {
                return cache;
            }
            ClassPathResource resource = new ClassPathResource("calendar/banners.json");
            try (InputStream in = resource.getInputStream()) {
                cache = objectMapper.readTree(in);
            } catch (Exception e) {
                throw new BusinessException(500, "卡池日历读取失败：" + e.getMessage());
            }
            return cache;
        }
    }
}
