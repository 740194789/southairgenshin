package com.southair.genshin.module.ocr.dto;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 抽卡记录识别结果：返回候选列表，由用户勾选、修正后再导入。
 */
public class OcrWishResult implements Serializable {

    private static final long serialVersionUID = 1L;

    private String engine;
    private String rawText;
    private List<OcrWishCandidate> candidates = new ArrayList<>();
    private List<String> warnings = new ArrayList<>();

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

    public List<OcrWishCandidate> getCandidates() {
        return candidates;
    }

    public void setCandidates(List<OcrWishCandidate> candidates) {
        this.candidates = candidates;
    }

    public List<String> getWarnings() {
        return warnings;
    }

    public void setWarnings(List<String> warnings) {
        this.warnings = warnings;
    }
}
