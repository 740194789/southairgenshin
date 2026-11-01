package com.southair.genshin.module.ocr.dto;

import java.io.Serializable;

/**
 * 截图识别出的单条抽卡记录候选，需用户确认后才会导入。
 */
public class OcrWishCandidate implements Serializable {

    private static final long serialVersionUID = 1L;

    private String itemName;
    /** 5 / 4 */
    private Integer rarity;
    private String pool;
    private Integer pityCount;
    /** yyyy-MM-dd HH:mm:ss */
    private String wishTime;
    /** 该记录在截图中的文字行坐标（像素），用于前端做头像匹配 */
    private Integer x;
    private Integer y;
    private Integer w;
    private Integer h;

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public Integer getRarity() {
        return rarity;
    }

    public void setRarity(Integer rarity) {
        this.rarity = rarity;
    }

    public String getPool() {
        return pool;
    }

    public void setPool(String pool) {
        this.pool = pool;
    }

    public Integer getPityCount() {
        return pityCount;
    }

    public void setPityCount(Integer pityCount) {
        this.pityCount = pityCount;
    }

    public String getWishTime() {
        return wishTime;
    }

    public void setWishTime(String wishTime) {
        this.wishTime = wishTime;
    }

    public Integer getX() {
        return x;
    }

    public void setX(Integer x) {
        this.x = x;
    }

    public Integer getY() {
        return y;
    }

    public void setY(Integer y) {
        this.y = y;
    }

    public Integer getW() {
        return w;
    }

    public void setW(Integer w) {
        this.w = w;
    }

    public Integer getH() {
        return h;
    }

    public void setH(Integer h) {
        this.h = h;
    }
}
