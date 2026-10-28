package com.southair.genshin;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * SouthAir Genshin 启动类。
 *
 * <p>提供 REST API + 响应式 Web 页面，同一套接口可被手机端（WebView / 小程序 / App）直接复用。</p>
 */
@SpringBootApplication
public class SouthAirGenshinApplication {

    public static void main(String[] args) {
        SpringApplication.run(SouthAirGenshinApplication.class, args);
    }
}
