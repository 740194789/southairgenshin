package com.southair.genshin.module.ocr;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 图像识别配置。
 *
 * <p>两种引擎：本地 Tesseract（后端调用命令行）、浏览器 tesseract.js（完全在前端执行，
 * 只把识别出的文本回传后端解析）。</p>
 */
@Component
@ConfigurationProperties(prefix = "app.ocr")
public class OcrProperties {

    private final Tesseract tesseract = new Tesseract();

    public Tesseract getTesseract() {
        return tesseract;
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
