package com.southair.genshin.module.ocr.dto;

import java.io.Serializable;

/**
 * 原始识别结果：只返回文本与 TSV 坐标，由前端按不同截图类型自行解析。
 */
public class OcrRawResult implements Serializable {

    private static final long serialVersionUID = 1L;

    private String engine;
    private String text;
    private String tsv;

    public String getEngine() {
        return engine;
    }

    public void setEngine(String engine) {
        this.engine = engine;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public String getTsv() {
        return tsv;
    }

    public void setTsv(String tsv) {
        this.tsv = tsv;
    }
}
