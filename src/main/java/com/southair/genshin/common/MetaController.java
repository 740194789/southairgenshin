package com.southair.genshin.common;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 无需登录的探活 / 元信息接口。
 */
@RestController
@RequestMapping("/api")
public class MetaController {

    @GetMapping("/ping")
    public R<Map<String, Object>> ping() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("app", "SouthAir Genshin");
        data.put("status", "UP");
        data.put("serverTime", LocalDateTime.now());
        return R.ok(data);
    }
}
