package com.southair.genshin.module.ocr.dto;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 资源截图识别结果：按资源字段返回候选数值，前端确认后再写入资源。
 */
public class OcrResourceResult {

    /** 识别引擎：tesseract */
    private String engine = "";

    /** 字段 key（primogems / mora / ...）→ 识别到的数值 */
    private Map<String, Long> values = new LinkedHashMap<>();

    /** 未识别到的字段 key 列表，前端用于提示 */
    private List<String> missing = new ArrayList<>();

    /** 原始识别文本，便于排查 */
    private String text = "";

    public String getEngine() {
        return engine;
    }

    public void setEngine(String engine) {
        this.engine = engine;
    }

    public Map<String, Long> getValues() {
        return values;
    }

    public void setValues(Map<String, Long> values) {
        this.values = values;
    }

    public List<String> getMissing() {
        return missing;
    }

    public void setMissing(List<String> missing) {
        this.missing = missing;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }
}
