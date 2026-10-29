package com.southair.genshin.module.ocr.dto;

import java.io.Serializable;

/**
 * 各识别引擎的可用状态，前端据此禁用不可用选项。
 */
public class OcrEngineStatus implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 视觉大模型是否已配置（Base URL + Key + 模型名） */
    private boolean visionConfigured;
    private String visionModel;

    /** 本机是否安装了 tesseract */
    private boolean tesseractAvailable;
    /** tesseract 不可用时的原因说明 */
    private String tesseractHint;

    /** 浏览器 OCR 永远可用（依赖 CDN 加载 tesseract.js） */
    private boolean browserAvailable = true;

    public boolean isVisionConfigured() {
        return visionConfigured;
    }

    public void setVisionConfigured(boolean visionConfigured) {
        this.visionConfigured = visionConfigured;
    }

    public String getVisionModel() {
        return visionModel;
    }

    public void setVisionModel(String visionModel) {
        this.visionModel = visionModel;
    }

    public boolean isTesseractAvailable() {
        return tesseractAvailable;
    }

    public void setTesseractAvailable(boolean tesseractAvailable) {
        this.tesseractAvailable = tesseractAvailable;
    }

    public String getTesseractHint() {
        return tesseractHint;
    }

    public void setTesseractHint(String tesseractHint) {
        this.tesseractHint = tesseractHint;
    }

    public boolean isBrowserAvailable() {
        return browserAvailable;
    }

    public void setBrowserAvailable(boolean browserAvailable) {
        this.browserAvailable = browserAvailable;
    }
}
