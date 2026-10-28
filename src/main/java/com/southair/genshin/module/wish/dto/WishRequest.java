package com.southair.genshin.module.wish.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonFormat;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.Size;
import java.time.LocalDateTime;

/**
 * 抽卡记录的新增 / 编辑请求。
 *
 * <p>三星（蓝色）记录可以不填名称，由服务端统一记为「三星物品」。</p>
 */
public class WishRequest {

    /** 批量编辑时用于定位记录，单条新增 / 编辑时忽略 */
    private Long id;

    @Size(max = 64, message = "名称最长 64 字")
    private String itemName;

    @Size(max = 16, message = "类型过长")
    private String itemType;

    @Size(max = 16, message = "卡池名称过长")
    private String pool;

    @Min(value = 1, message = "星级不合法")
    @Max(value = 5, message = "星级不合法")
    private Integer rarity;

    private Boolean isUp;

    @JsonAlias("pity")
    @Min(value = 1, message = "保底计数范围为 1-180")
    @Max(value = 180, message = "保底计数范围为 1-180")
    private Integer pityCount;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime wishTime;

    @Size(max = 255, message = "备注最长 255 字")
    private String note;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public String getItemType() {
        return itemType;
    }

    public void setItemType(String itemType) {
        this.itemType = itemType;
    }

    public String getPool() {
        return pool;
    }

    public void setPool(String pool) {
        this.pool = pool;
    }

    public Integer getRarity() {
        return rarity;
    }

    public void setRarity(Integer rarity) {
        this.rarity = rarity;
    }

    public Boolean getIsUp() {
        return isUp;
    }

    public void setIsUp(Boolean isUp) {
        this.isUp = isUp;
    }

    public Integer getPityCount() {
        return pityCount;
    }

    public void setPityCount(Integer pityCount) {
        this.pityCount = pityCount;
    }

    public LocalDateTime getWishTime() {
        return wishTime;
    }

    public void setWishTime(LocalDateTime wishTime) {
        this.wishTime = wishTime;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }
}
