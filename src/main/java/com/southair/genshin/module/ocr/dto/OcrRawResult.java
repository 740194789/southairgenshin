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
    /** 命之座界面里识别出的已激活命座数；不是该界面时为 null */
    private Integer constellation;
    /** 左上角识别出的角色名称；不是角色详情页时为 null */
    private String characterName;
    /** 武器详情页识别出的武器名称；不是武器详情页时为 null */
    private String weaponName;
    /** 武器详情页识别出的精炼等级（1-5）；读不到时为 null */
    private Integer weaponRank;

    public String getCharacterName() {
        return characterName;
    }

    public void setCharacterName(String characterName) {
        this.characterName = characterName;
    }

    public String getWeaponName() {
        return weaponName;
    }

    public void setWeaponName(String weaponName) {
        this.weaponName = weaponName;
    }

    public Integer getWeaponRank() {
        return weaponRank;
    }

    public void setWeaponRank(Integer weaponRank) {
        this.weaponRank = weaponRank;
    }

    /** 命之座界面右侧的命座名 OCR 文本；角色名没读到时前端用它反查角色 */
    private String constellationText;

    public String getConstellationText() {
        return constellationText;
    }

    public void setConstellationText(String constellationText) {
        this.constellationText = constellationText;
    }

    public Integer getConstellation() {
        return constellation;
    }

    public void setConstellation(Integer constellation) {
        this.constellation = constellation;
    }

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
