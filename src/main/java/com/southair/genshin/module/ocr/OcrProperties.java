package com.southair.genshin.module.ocr;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 图像识别配置。
 *
 * <p>三种引擎：视觉大模型（OpenAI 兼容接口）、本地 Tesseract、浏览器 tesseract.js。
 * 前两者由后端调用，第三者完全在前端执行，只把识别出的文本回传后端解析。</p>
 */
@Component
@ConfigurationProperties(prefix = "app.ocr")
public class OcrProperties {

    private final Vision vision = new Vision();
    private final Tesseract tesseract = new Tesseract();

    public Vision getVision() {
        return vision;
    }

    public Tesseract getTesseract() {
        return tesseract;
    }

    public static class Vision {

        /** OpenAI 兼容接口根地址，如 https://api.openai.com/v1 */
        private String baseUrl = "";
        private String apiKey = "";
        /** 视觉模型名，如 gpt-4o-mini / qwen-vl-max / glm-4v */
        private String model = "";
        private int timeoutSeconds = 60;

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public String getApiKey() {
            return apiKey;
        }

        public void setApiKey(String apiKey) {
            this.apiKey = apiKey;
        }

        public String getModel() {
            return model;
        }

        public void setModel(String model) {
            this.model = model;
        }

        public int getTimeoutSeconds() {
            return timeoutSeconds;
        }

        public void setTimeoutSeconds(int timeoutSeconds) {
            this.timeoutSeconds = timeoutSeconds;
        }
    }

    public static class Tesseract {

        /** tesseract 可执行文件路径（已在 PATH 中时直接写 tesseract） */
        private String command = "tesseract";
        /** 语言包，需包含中文与英文 */
        private String lang = "chi_sim+eng";
        private int timeoutSeconds = 30;

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public String getLang() {
            return lang;
        }

        public void setLang(String lang) {
            this.lang = lang;
        }

        public int getTimeoutSeconds() {
            return timeoutSeconds;
        }

        public void setTimeoutSeconds(int timeoutSeconds) {
            this.timeoutSeconds = timeoutSeconds;
        }
    }
}
