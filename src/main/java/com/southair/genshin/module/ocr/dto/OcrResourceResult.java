package com.southair.genshin.module.ocr.dto;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 资源识别结果：各字段为 null 表示该资源未识别到。
 */
public class OcrResourceResult implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long primogems;
    private Long mora;
    private Long intertwinedFates;
    private Long acquaintedFates;

    /** 实际使用的引擎：tesseract / browser */
    private String engine;
    /** 识别出的原始文本，便于前端展开查看与人工核对 */
    private String rawText;
    /** 需要提醒用户注意的问题 */
    private List<String> warnings = new ArrayList<>();

    public Long getPrimogems() {
        return primogems;
    }

    public void setPrimogems(Long primogems) {
        this.primogems = primogems;
    }

    public Long getMora() {
        return mora;
    }

    public void setMora(Long mora) {
        this.mora = mora;
    }

    public Long getIntertwinedFates() {
        return intertwinedFates;
    }

    public void setIntertwinedFates(Long intertwinedFates) {
        this.intertwinedFates = intertwinedFates;
    }

    public Long getAcquaintedFates() {
        return acquaintedFates;
    }

    public void setAcquaintedFates(Long acquaintedFates) {
        this.acquaintedFates = acquaintedFates;
    }

    public String getEngine() {
        return engine;
    }

    public void setEngine(String engine) {
        this.engine = engine;
    }

    public String getRawText() {
        return rawText;
    }

    public void setRawText(String rawText) {
        this.rawText = rawText;
    }

    public List<String> getWarnings() {
        return warnings;
    }

    public void setWarnings(List<String> warnings) {
        this.warnings = warnings;
    }
}
